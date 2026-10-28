
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  User,
  Counter,
  Conversation,
  Message,
  AppConfig
} from './models';

const app = express();

// Render and similar platforms sit behind a reverse proxy. Trust one proxy hop
// so express-rate-limit can use the forwarded client IP without throwing
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on registration/login requests.
app.set('trust proxy', 1);

const server = http.createServer(app);

const origins = (process.env.CLIENT_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: origins.length ? origins : false,
    methods: ['GET', 'POST']
  }
});

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || '';

if (
  process.env.NODE_ENV === 'production' &&
  JWT_SECRET.length < 32
) {
  throw new Error(
    'JWT_SECRET must be a long random secret in production'
  );
}

if (!JWT_SECRET) {
  console.warn(
    'WARNING: JWT_SECRET is not set; set it before deployment.'
  );
}

app.disable('x-powered-by');
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || origins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Origin not allowed'));
    },
    credentials: false
  })
);

app.use(express.json({ limit: '3mb' }));
app.use(rateLimit({ windowMs: 60 * 1000, limit: 180, standardHeaders: true, legacyHeaders: false }));

app.use(
  '/api/auth',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
);

interface AuthRequest extends Request {
  auth?: {
    userId: string;
    role: string;
  };
}

function normalizePhone(value: string): string {
  const compact = value.trim().replace(/[\s().-]/g, '');
  return compact.startsWith('+') ? `+${compact.slice(1).replace(/\D/g, '')}` : `+${compact.replace(/\D/g, '')}`;
}

function validPhone(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function tokenFor(userId: string, role: string): string {
  const expiresIn = (
    process.env.JWT_EXPIRES_IN || '30d'
  ) as jwt.SignOptions['expiresIn'];

  return jwt.sign(
    { userId, role },
    JWT_SECRET,
    { expiresIn }
  );
}

function auth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : '';

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; role: string };
    User.exists({ userId: decoded.userId, blocked: false }).then((active) => {
      if (!active) {
        res.status(401).json({ error: 'Account unavailable. Please contact support if you think this is a mistake.' });
        return;
      }
      req.auth = decoded;
      next();
    }).catch(() => res.status(503).json({ error: 'Account service temporarily unavailable.' }));
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

function adminKey(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const configured = process.env.ADMIN_API_KEY;

  if (
    !configured ||
    configured.startsWith('REPLACE_') ||
    req.header('x-admin-api-key') !== configured
  ) {
    res.status(401).json({
      error: 'Admin authentication failed'
    });
    return;
  }

  next();
}

const asyncRoute = (
  fn: (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<unknown>
) => {
  return (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'GlobalChat API',
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected'
  });
});

app.post(
  '/api/auth/register',
  asyncRoute(async (req, res) => {
    const parsed = z.object({
      displayName: z.string().trim().min(1).max(50),
      phoneNumber: z.string().min(7).max(24),
      password: z.string().min(10).max(128)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Enter a display name, a valid phone number with country code, and a password of at least 10 characters.'
      });
    }

    const phoneNumber = normalizePhone(parsed.data.phoneNumber);
    if (!validPhone(phoneNumber)) {
      return res.status(400).json({ error: 'Use international format, e.g. +919876543210.' });
    }
    if (await User.exists({ phoneNumber })) {
      return res.status(409).json({ error: 'This phone number already has an account. Log in instead.' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    for (let i = 0; i < 5; i++) {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'userId' }, { $inc: { seq: 1 } }, { upsert: true, new: true }
      );
      const userId = String(counter.seq);
      try {
        const user = await User.create({
          userId, phoneNumber, displayName: parsed.data.displayName, passwordHash
        });
        return res.status(201).json({
          token: tokenFor(user.userId, user.role),
          user: { userId: user.userId, phoneNumber: user.phoneNumber, displayName: user.displayName, avatarUrl: user.avatarUrl }
        });
      } catch (error: unknown) {
        const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
        if (duplicate) {
          if (await User.exists({ phoneNumber })) return res.status(409).json({ error: 'This phone number already has an account. Log in instead.' });
          continue;
        }
        throw error;
      }
    }
    return res.status(500).json({ error: 'Could not create account. Please try again.' });
  })
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const parsed = z.object({
      phoneNumber: z.string().min(7).max(24).optional(),
      userId: z.string().regex(/^\d{6,20}$/).optional(),
      password: z.string().min(1).max(128)
    }).refine((v) => Boolean(v.phoneNumber || v.userId)).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter your phone number or GlobalChat ID and password.' });

    let lookup: Record<string, string>;
    if (parsed.data.phoneNumber) {
      const phoneNumber = normalizePhone(parsed.data.phoneNumber);
      if (!validPhone(phoneNumber)) return res.status(400).json({ error: 'Use international format, e.g. +919876543210.' });
      lookup = { phoneNumber };
    } else {
      lookup = { userId: parsed.data.userId! };
    }
    const user = await User.findOne(lookup).select('+passwordHash');
    if (!user || user.blocked || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials or account unavailable.' });
    }
    return res.json({
      token: tokenFor(user.userId, user.role),
      user: { userId: user.userId, phoneNumber: user.phoneNumber || '', displayName: user.displayName, avatarUrl: user.avatarUrl || '' }
    });
  })
);

app.get('/api/me', auth, asyncRoute(async (req, res) => {
  const userId = (req as AuthRequest).auth!.userId;
  const user = await User.findOne({ userId, blocked: false }).select('userId phoneNumber displayName avatarUrl createdAt');
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  return res.json({ user });
}));

app.patch('/api/me', auth, asyncRoute(async (req, res) => {
  const parsed = z.object({
    displayName: z.string().trim().min(1).max(50).optional(),
    avatarUrl: z.string().trim().max(500).refine((v) => !v || /^https:\/\//i.test(v), 'Avatar must be an HTTPS URL').optional()
  }).safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data || {}).length === 0) return res.status(400).json({ error: 'Enter a valid display name or HTTPS avatar URL.' });
  const user = await User.findOneAndUpdate({ userId: (req as AuthRequest).auth!.userId, blocked: false }, { $set: parsed.data }, { new: true }).select('userId phoneNumber displayName avatarUrl');
  if (!user) return res.status(404).json({ error: 'Account not found.' });
  return res.json({ user });
}));

app.get('/api/users/search', auth, asyncRoute(async (req, res) => {
  const raw = String(req.query.q || '').trim();
  if (raw.length < 3 || raw.length > 24) return res.status(400).json({ error: 'Enter at least 3 digits to search.' });
  const currentId = (req as AuthRequest).auth!.userId;
  const digits = raw.replace(/[^0-9]/g, '');
  const phone = digits ? `+${digits}` : '';
  const filter: Record<string, unknown> = { blocked: false, userId: { $ne: currentId } };
  if (/^\d+$/.test(raw)) filter.$or = [{ userId: raw }, { phoneNumber: phone }];
  else filter.phoneNumber = normalizePhone(raw);
  const users = await User.find(filter).select('userId displayName avatarUrl').limit(10).lean();
  return res.json({ users });
}));

app.get(
  '/api/users/:userId',
  auth,
  asyncRoute(async (req, res) => {
    if (!/^\d{6,20}$/.test(req.params.userId)) {
      return res.status(400).json({
        error: 'Invalid user ID'
      });
    }

    const user = await User.findOne({
      userId: req.params.userId,
      blocked: false
    }).select('userId displayName avatarUrl');

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({ user });
  })
);

app.get(
  '/api/conversations',
  auth,
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    const items = await Conversation.find({
      members: authUser.auth!.userId
    })
      .sort({ lastMessageAt: -1 })
      .limit(100)
      .lean();

    res.json({
      conversations: items.map((conversation) => ({
        ...conversation,
        displayName:
          conversation.kind === 'direct'
            ? 'Direct conversation'
            : conversation.name
      }))
    });
  })
);

app.post(
  '/api/conversations/direct',
  auth,
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    const parsed = z.object({
      otherUserId: z.string().regex(/^\d{6,20}$/)
    }).safeParse(req.body);

    if (
      !parsed.success ||
      parsed.data.otherUserId === authUser.auth!.userId
    ) {
      return res.status(400).json({
        error: 'Enter a valid different user ID.'
      });
    }

    const other = await User.findOne({
      userId: parsed.data.otherUserId,
      blocked: false
    });

    if (!other) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const members = [
      authUser.auth!.userId,
      other.userId
    ].sort();

    let conversation = await Conversation.findOne({
      kind: 'direct',
      members: { $all: members, $size: 2 }
    });

    if (!conversation) {
      conversation = await Conversation.create({
        kind: 'direct',
        members,
        createdBy: authUser.auth!.userId
      });
    }

    res.json({ conversation });
  })
);

app.post(
  '/api/conversations/group',
  auth,
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    const parsed = z.object({
      name: z.string().trim().min(1).max(80),
      memberIds: z.array(
        z.string().regex(/^\d{6,20}$/)
      ).max(99)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid group details.'
      });
    }

    const members = [
      ...new Set([
        authUser.auth!.userId,
        ...parsed.data.memberIds
      ])
    ];

    const count = await User.countDocuments({
      userId: { $in: members },
      blocked: false
    });

    if (count !== members.length) {
      return res.status(400).json({
        error: 'One or more users were not found.'
      });
    }

    const conversation = await Conversation.create({
      kind: 'group',
      name: parsed.data.name,
      members,
      createdBy: authUser.auth!.userId
    });

    res.status(201).json({ conversation });
  })
);

app.get(
  '/api/conversations/:id/messages',
  auth,
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid conversation ID'
      });
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      members: authUser.auth!.userId
    });

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    const before = req.query.before
      ? new Date(String(req.query.before))
      : new Date();

    const messages = await Message.find({
      conversationId: conversation._id,
      createdAt: { $lt: before }
    }).select('-audioData')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json({
      messages: messages.reverse()
    });
  })
);

app.post(
  '/api/conversations/:id/messages',
  auth,
  rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }),
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid conversation ID'
      });
    }

    const parsed = z.object({
      text: z.string().trim().min(1).max(4000).optional(),
      audioBase64: z.string().max(2500000).optional(),
      audioMimeType: z.enum(['audio/mp4', 'audio/aac', 'audio/m4a', 'audio/mpeg', 'audio/wav']).optional()
    }).refine((v) => Boolean(v.text) !== Boolean(v.audioBase64), 'Send either text or a voice message.').safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({ error: 'Send a text message (up to 4000 characters) or a voice note under the upload limit.' });
    }
    if (parsed.data.audioBase64 && !/^[A-Za-z0-9+/]+={0,2}$/.test(parsed.data.audioBase64)) {
      return res.status(400).json({ error: 'Invalid voice message data.' });
    }

    const conversation = await Conversation.findOne({
      _id: req.params.id,
      members: authUser.auth!.userId
    });

    if (!conversation) {
      return res.status(404).json({
        error: 'Conversation not found'
      });
    }

    const isVoice = Boolean(parsed.data.audioBase64);
    const message = await Message.create({
      conversationId: conversation._id,
      senderId: authUser.auth!.userId,
      text: isVoice ? 'Voice message' : (parsed.data.text || ''),
      messageType: isVoice ? 'voice' : 'text',
      audioData: parsed.data.audioBase64 || '',
      audioMimeType: parsed.data.audioMimeType || 'audio/mp4'
    });

    conversation.lastMessageAt = new Date();
    await conversation.save();

    const dto = {
      id: String(message._id),
      conversationId: String(conversation._id),
      senderId: authUser.auth!.userId,
      text: message.text,
      messageType: message.messageType,
      createdAt: message.createdAt
    };

    io.to(`conversation:${conversation._id}`).emit(
      'message:new',
      dto
    );

    for (const member of conversation.members) {
      io.to(`user:${member}`).emit(
        'conversation:updated',
        {
          conversationId: String(conversation._id),
          lastMessageAt: message.createdAt
        }
      );
    }

    res.status(201).json({ message: dto });
  })
);

app.get('/api/conversations/:id/messages/:messageId/audio', auth, asyncRoute(async (req, res) => {
  const authUser = req as AuthRequest;
  if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ error: 'Invalid message reference.' });
  const conversation = await Conversation.findOne({ _id: req.params.id, members: authUser.auth!.userId });
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  const message = await Message.findOne({ _id: req.params.messageId, conversationId: conversation._id, messageType: 'voice' }).select('+audioData audioMimeType');
  if (!message || !message.audioData) return res.status(404).json({ error: 'Voice message not found.' });
  const audio = Buffer.from(message.audioData, 'base64');
  res.setHeader('Content-Type', message.audioMimeType || 'audio/mp4');
  res.setHeader('Content-Length', String(audio.length));
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).send(audio);
}));

app.get('/api/config', asyncRoute(async (_req, res) => {
  const docs = await AppConfig.find({ key: { $in: ['appName', 'primaryColor', 'announcement', 'logoUrl', 'downloadUrl', 'maintenanceMode'] } }).lean();
  const config: Record<string, unknown> = {};
  for (const doc of docs) if (typeof doc.key === 'string') config[doc.key] = doc.value;
  return res.json({ config: {
    appName: config.appName || 'GlobalChat', primaryColor: config.primaryColor || '#6658F5',
    announcement: config.announcement || '', logoUrl: config.logoUrl || '',
    downloadUrl: config.downloadUrl || '', maintenanceMode: Boolean(config.maintenanceMode)
  } });
}));

app.get(
  '/api/admin/stats',
  adminKey,
  asyncRoute(async (_req, res) => {
    res.json({
      users: await User.countDocuments(),
      conversations: await Conversation.countDocuments(),
      messages: await Message.countDocuments(),
      database:
        mongoose.connection.readyState === 1
          ? 'connected'
          : 'disconnected'
    });
  })
);

app.get(
  '/api/admin/config',
  adminKey,
  asyncRoute(async (_req, res) => {
    const docs = await AppConfig.find().lean();
    const config: Record<string, unknown> = {};

    for (const doc of docs) {
      const key = doc.key;

      if (typeof key === 'string' && key.length > 0) {
        config[key] = doc.value;
      }
    }

    res.json({
      config: {
        appName: config.appName || 'GlobalChat',
        primaryColor: config.primaryColor || '#6658F5',
        announcement: config.announcement || '',
        logoUrl: config.logoUrl || '',
        downloadUrl: config.downloadUrl || '',
        maintenanceMode: Boolean(config.maintenanceMode)
      }
    });
  })
);

app.put(
  '/api/admin/config',
  adminKey,
  asyncRoute(async (req, res) => {
    const parsed = z.object({
      appName: z.string().trim().min(1).max(40).optional(),
      primaryColor: z.string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      announcement: z.string().max(300).optional(),
      logoUrl: z.string().max(500).refine((v) => !v || /^https:\/\//i.test(v), 'Logo URL must be HTTPS').optional(),
      downloadUrl: z.string().max(500).refine((v) => !v || /^https:\/\//i.test(v), 'Download URL must be HTTPS').optional(),
      maintenanceMode: z.boolean().optional()
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid configuration'
      });
    }

    for (const [key, value] of Object.entries(parsed.data)) {
      await AppConfig.findOneAndUpdate(
        { key },
        { $set: { value } },
        { upsert: true }
      );
    }

    res.json({ ok: true });
  })
);

app.get('/api/admin/users', adminKey, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const filter: any = {};
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (q) filter.$or = [
    { userId: { $regex: escaped } },
    { displayName: { $regex: escaped, $options: 'i' } },
    { phoneNumber: { $regex: escaped } }
  ];
  const users = await User.find(filter).select('userId displayName phoneNumber blocked createdAt').sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ users });
}));

app.patch('/api/admin/users/:userId/block', adminKey, asyncRoute(async (req, res) => {
  const parsed = z.object({ blocked: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'blocked must be true or false.' });
  const existing = await User.findOne({ userId: req.params.userId }).select('userId role');
  if (!existing) return res.status(404).json({ error: 'User not found.' });
  if (existing.role === 'admin') return res.status(400).json({ error: 'Administrator accounts cannot be blocked here.' });
  const user = await User.findOneAndUpdate({ userId: req.params.userId }, { $set: { blocked: parsed.data.blocked } }, { new: true }).select('userId blocked');
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.blocked) io.in(`user:${user.userId}`).disconnectSockets(true);
  return res.json({ user });
}));

io.use(async (socket, next) => {
  try {
    const token = String(
      socket.handshake.auth?.token || ''
    );

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    ) as { userId: string; role: string };
    const activeUser = await User.exists({ userId: decoded.userId, blocked: false });
    if (!activeUser) return next(new Error('Account unavailable'));
    (socket.data as any).user = decoded;
    next();
  } catch {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket.data as any).user.userId as string;

  socket.join(`user:${userId}`);

  socket.on(
    'conversation:join',
    async (payload: { conversationId?: string }) => {
      if (
        !payload?.conversationId ||
        !mongoose.isValidObjectId(payload.conversationId)
      ) {
        return;
      }

      const allowed = await Conversation.exists({
        _id: payload.conversationId,
        members: userId
      });

      if (allowed) {
        socket.join(`conversation:${payload.conversationId}`);
      }
    }
  );

  socket.on(
    'message:send',
    async (
      payload: {
        conversationId?: string;
        text?: string;
        clientMessageId?: string;
      },
      acknowledge?: (value: any) => void
    ) => {
      try {
        const text =
          typeof payload?.text === 'string'
            ? payload.text.trim()
            : '';

        if (
          !payload?.conversationId ||
          !mongoose.isValidObjectId(payload.conversationId) ||
          !text ||
          text.length > 4000
        ) {
          acknowledge?.({
            ok: false,
            error: 'Invalid message'
          });
          return;
        }

        const conversation = await Conversation.findOne({
          _id: payload.conversationId,
          members: userId
        });

        if (!conversation) {
          acknowledge?.({
            ok: false,
            error: 'Conversation not found'
          });
          return;
        }

        const message = await Message.create({
          conversationId: conversation._id,
          senderId: userId,
          text,
          clientMessageId: String(
            payload.clientMessageId || ''
          ).slice(0, 100)
        });

        conversation.lastMessageAt = new Date();
        await conversation.save();

        const dto = {
          id: String(message._id),
          conversationId: String(conversation._id),
          senderId: userId,
          text: message.text,
          createdAt: message.createdAt,
          clientMessageId: message.clientMessageId
        };

        io.to(`conversation:${conversation._id}`).emit(
          'message:new',
          dto
        );

        for (const member of conversation.members) {
          io.to(`user:${member}`).emit(
            'conversation:updated',
            {
              conversationId: String(conversation._id),
              lastMessageAt: message.createdAt
            }
          );
        }

        acknowledge?.({
          ok: true,
          message: dto
        });
      } catch {
        acknowledge?.({
          ok: false,
          error: 'Message could not be sent'
        });
      }
    }
  );
});

app.use((
  error: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  console.error(
    'Request failed:',
    error?.message || 'unknown error'
  );

  res.status(500).json({
    error: 'Internal server error'
  });
});

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(process.env.MONGODB_URI);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`GlobalChat API listening on ${PORT}`);
  });
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error('Startup failed:', message);
  process.exit(1);
});

