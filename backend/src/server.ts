
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

app.use(express.json({ limit: '32kb' }));

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

function tokenFor(userId: string, role: string): string {
  const expiresIn = (
    process.env.JWT_EXPIRES_IN || '1h'
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
    const decoded = jwt.verify(
      token,
      JWT_SECRET
    ) as { userId: string; role: string };

    req.auth = decoded;
    next();
  } catch {
    res.status(401).json({
      error: 'Authentication required'
    });
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
      password: z.string().min(10).max(128)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error:
          'Display name is required and password must be 10–128 characters.'
      });
    }

    const passwordHash = await bcrypt.hash(
      parsed.data.password,
      12
    );

    let userId = '';

    for (let i = 0; i < 5; i++) {
      const counter = await Counter.findOneAndUpdate(
        { _id: 'userId' },
        { $inc: { seq: 1 } },
        { upsert: true, new: true }
      );

      userId = String(counter.seq);

      try {
        const user = await User.create({
          userId,
          displayName: parsed.data.displayName,
          passwordHash
        });

        return res.status(201).json({
          token: tokenFor(user.userId, user.role),
          user: {
            userId: user.userId,
            displayName: user.displayName
          }
        });
      } catch (error: unknown) {
        const duplicateError =
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 11000;

        if (!duplicateError) {
          throw error;
        }
      }
    }

    return res.status(500).json({
      error: 'Could not allocate a unique ID. Try again.'
    });
  })
);

app.post(
  '/api/auth/login',
  asyncRoute(async (req, res) => {
    const parsed = z.object({
      userId: z.string().regex(/^\d{6,20}$/),
      password: z.string().min(1).max(128)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid user ID or password format.'
      });
    }

    const user = await User.findOne({
      userId: parsed.data.userId
    }).select('+passwordHash');

    if (
      !user ||
      user.blocked ||
      !(await bcrypt.compare(
        parsed.data.password,
        user.passwordHash
      ))
    ) {
      return res.status(401).json({
        error: 'Invalid user ID or password.'
      });
    }

    return res.json({
      token: tokenFor(user.userId, user.role),
      user: {
        userId: user.userId,
        displayName: user.displayName
      }
    });
  })
);

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
    }).select('userId displayName');

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
    })
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
  asyncRoute(async (req, res) => {
    const authUser = req as AuthRequest;

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({
        error: 'Invalid conversation ID'
      });
    }

    const parsed = z.object({
      text: z.string().trim().min(1).max(4000)
    }).safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: 'Message must be 1–4000 characters.'
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

    const message = await Message.create({
      conversationId: conversation._id,
      senderId: authUser.auth!.userId,
      text: parsed.data.text
    });

    conversation.lastMessageAt = new Date();
    await conversation.save();

    const dto = {
      id: String(message._id),
      conversationId: String(conversation._id),
      senderId: authUser.auth!.userId,
      text: message.text,
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
        primaryColor: config.primaryColor || '#315CFF',
        announcement: config.announcement || ''
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
      announcement: z.string().max(300).optional()
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

io.use(async (socket, next) => {
  try {
    const token = String(
      socket.handshake.auth?.token || ''
    );

    const decoded = jwt.verify(
      token,
      JWT_SECRET
    ) as { userId: string; role: string };

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

