const express = require('express');
const router = express.Router();
const { auth, admin } = require('../middleware/auth');
const userModel = require('../models/user');
const transactionModel = require('../models/transaction');

// Get all users (admin only)
router.get('/users', auth, admin, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { accountNumber: search }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const users = await userModel.paginate(query, options);

    res.json({
      success: true,
      data: users
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching users'
    });
  }
});

// Get all transactions (admin only)
router.get('/transactions', auth, admin, async (req, res) => {
  try {
    const { page = 1, limit = 50, status, type, startDate, endDate } = req.query;
    
    const query = {};
    if (status) query.status = status;
    if (type) query.type = type;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: 'userId'
    };

    const transactions = await transactionModel.paginate(query, options);

    res.json({
      success: true,
      data: transactions
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching transactions'
    });
  }
});

// Update transaction status (admin only)
router.put('/transactions/:id/status', auth, admin, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['completed', 'failed', 'cancelled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const transaction = await transactionModel.findById(req.params.id).populate('userId');
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    // Only allow status change for pending transactions
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Only pending transactions can be updated'
      });
    }

    const oldStatus = transaction.status;
    transaction.status = status;
    
    if (status === 'completed') {
      transaction.completedAt = new Date();
      
      // Update balances
      const sender = await userModel.findById(transaction.userId);
      const receiver = await userModel.findOne({ accountNumber: transaction.receiver.accountNumber });
      
      if (sender && transaction.type === 'debit') {
        sender.balance -= transaction.amount;
        await sender.save();
      }
      
      if (receiver && transaction.type === 'credit') {
        receiver.balance += transaction.netAmount;
        await receiver.save();
      }
      
      // Create corresponding transaction for receiver
      if (receiver) {
        const receiverTransaction = new transactionModel({
          userId: receiver._id,
          transactionId: transactionModel.generateTransactionId(),
          type: 'credit',
          amount: transaction.netAmount,
          netAmount: transaction.netAmount,
          description: `Transfer from ${sender.name}`,
          status: 'completed',
          category: 'transfer',
          sender: {
            userId: sender._id,
            name: sender.name,
            accountNumber: sender.accountNumber
          },
          receiver: {
            userId: receiver._id,
            name: receiver.name,
            accountNumber: receiver.accountNumber
          },
          completedAt: new Date()
        });
        
        await receiverTransaction.save();
      }
    }

    await transactionModel.save();

    res.json({
      success: true,
      message: `Transaction status updated from ${oldStatus} to ${status}`,
      data: transaction
    });

  } catch (error) {
    console.error('Update transaction status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating transaction status'
    });
  }
});

// Get system statistics (admin only)
router.get('/stats', auth, admin, async (req, res) => {
  try {
    const totalUsers = await userModel.countDocuments();
    const activeUsers = await userModel.countDocuments({ status: 'active' });
    const totalBalance = await userModel.aggregate([
      { $group: { _id: null, total: { $sum: '$balance' } } }
    ]);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaysTransactions = await transactionModel.countDocuments({
      createdAt: { $gte: today }
    });
    
    const todaysVolume = await transactionModel.aggregate([
      {
        $match: {
          createdAt: { $gte: today },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsers,
        suspendedUsers: totalUsers - activeUsers,
        totalBalance: totalBalance[0]?.total || 0,
        todaysTransactions,
        todaysVolume: todaysVolume[0]?.total || 0,
        systemUptime: process.uptime()
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching statistics'
    });
  }
});

module.exports = router;