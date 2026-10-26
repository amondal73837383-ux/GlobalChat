import mongoose, { Schema } from 'mongoose';

const UserSchema = new Schema({
  userId: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true, trim: true, maxlength: 50 },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  blocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const CounterSchema = new Schema({ _id: String, seq: { type: Number, default: 100000000000 } });
const ConversationSchema = new Schema({
  kind: { type: String, enum: ['direct', 'group'], required: true },
  name: { type: String, default: '' },
  members: [{ type: String, required: true, index: true }],
  createdBy: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  lastMessageAt: { type: Date, default: Date.now }
});
const MessageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: String, required: true, index: true },
  text: { type: String, required: true, maxlength: 4000 },
  createdAt: { type: Date, default: Date.now },
  clientMessageId: { type: String, default: '' }
});
MessageSchema.index({ conversationId: 1, createdAt: -1 });
const ConfigSchema = new Schema({ key: { type: String, unique: true }, value: { type: Schema.Types.Mixed } });
export const User = mongoose.model('User', UserSchema);
export const Counter = mongoose.model('Counter', CounterSchema);
export const Conversation = mongoose.model('Conversation', ConversationSchema);
export const Message = mongoose.model('Message', MessageSchema);
export const AppConfig = mongoose.model('AppConfig', ConfigSchema);
