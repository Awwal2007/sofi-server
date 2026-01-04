const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  transactionId: {
    type: String,
    required: true,
    unique: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit', 'transfer'],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0.01
  },
  currency: {
    type: String,
    default: 'USD'
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  category: {
    type: String,
    enum: ['transfer', 'deposit', 'withdrawal', 'payment', 'refund', 'fee', 'interest'],
    required: true
  },
  sender: {
    name: String,
    accountNumber: String,
    userId: mongoose.Schema.Types.ObjectId
  },
  receiver: {
    name: String,
    accountNumber: String,
    userId: Number
    // userId: mongoose.Schema.Types.ObjectId
  },
  metadata: {
    ipAddress: String,
    userAgent: String,
    location: String,
    deviceId: String
  },
  fees: {
    type: Number,
    default: 0
  },
  netAmount: {
    type: Number,
    required: true
  },
  notes: String,
  scheduledFor: Date,
  completedAt: Date,
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Generate transaction ID
transactionSchema.statics.generateTransactionId = function() {
  const timestamp = Date.now().toString();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `TRX${timestamp}${random}`;
};

// Indexes for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ 'sender.accountNumber': 1 });
transactionSchema.index({ 'receiver.accountNumber': 1 });

const transactionModel = mongoose.model('Transaction', transactionSchema);

module.exports = transactionModel