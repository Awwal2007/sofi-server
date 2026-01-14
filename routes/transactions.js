const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const User = require('../models/user');
const Transaction = require('../models/transaction');

// Get all transactions with pagination
router.get('/', auth, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      type,
      status,
      category,
      startDate,
      endDate,
      search
    } = req.query;

    const query = { userId: req.user._id };

    // Apply filters
    if (type) query.type = type;
    if (status) query.status = status;
    if (category) query.category = category;
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    // Search filter
    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { 'sender.name': { $regex: search, $options: 'i' } },
        { 'receiver.name': { $regex: search, $options: 'i' } },
        { 'sender.accountNumber': search },
        { 'receiver.accountNumber': search }
      ];
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 }
    };

    const transactions = await Transaction.find(query);

    res.json({
      success: true,
      data: transactions
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching transactions'
    });
  }
});

// Get transaction by ID
router.get('/:id', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      transactionId: req.params.id,
      userId: req.user._id
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    res.json({
      success: true,
      data: transaction
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error fetching transaction'
    });
  }
});

// Transfer money
router.post('/transfer', auth, [
  body('toAccount').notEmpty().trim(),
  body('amount').isFloat({ min: 0.01 }),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { toAccount, amount, description } = req.body;
    const user = req.user;

    // Check if transferring to own account
    if (toAccount === user.accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer to your own account'
      });
    }

    // Check balance
    if (user.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient funds'
      });
    }

    // Check daily transfer limit
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todaysTransfers = await Transaction.find({
      userId: user._id,
      type: 'transfer',
      status: 'completed',
      createdAt: { $gte: today }
    });

    const todaysTotal = todaysTransfers.reduce((sum, t) => sum + t.amount, 0);
    const dailyLimit = 10000; // $10,000 daily limit
    
    if (todaysTotal + amount > dailyLimit) {
      return res.status(400).json({
        success: false,
        message: `Daily transfer limit of $${dailyLimit} exceeded`
      });
    }



    // Find recipient (simplified - in real app, would check against user database)
    // const recipientExists = await User.findOne({ accountNumber: toAccount });
    
    const recipientExists = {
      _id: Math.floor(Math.random() * 10000000),
      accountNumber: toAccount,
    }
    
    // if (!recipientExists) {
    //   return res.status(404).json({
    //     success: false,
    //     message: 'Recipient account not found'
    //   });
    // }

    // Calculate fees
    const transferFee = 0; // Free transfers for demo
    const netAmount = amount - transferFee;

    // Create transaction record
    const transaction = new Transaction({
      userId: user._id,
      transactionId: Transaction.generateTransactionId(),
      type: 'transfer',
      amount,
      netAmount,
      fees: transferFee,
      description: description || `Transfer to account ${toAccount}`,
      status: 'pending',
      category: 'transfer',
      sender: {
        userId: user._id,
        name: user.name,
        accountNumber: user.accountNumber
      },
      receiver: {
        userId: recipientExists._id,
        // name: recipientExists.name,
        accountNumber: recipientExists.accountNumber
      },
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // Process transfer (simplified - in real app, would use transaction locking)
    // For demo: First transfer succeeds, second goes pending, third fails
    const completedTransfers = await Transaction.countDocuments({
      userId: user._id,
      type: 'transfer',
      status: 'completed'
    });

    if (completedTransfers === 0) {
      transaction.status = 'completed';
      transaction.completedAt = new Date();
      
      // Update balances
      user.balance -= amount;
      await user.save();
      
      // recipientExists.balance += netAmount;
      // await recipientExists.save();
    } 

    await transaction.save();

    // Create notification for recipient if transfer is completed
    // if (transaction.status === 'completed') {
    //   const recipientTransaction = new Transaction({
    //     userId: recipientExists._id,
    //     transactionId: Transaction.generateTransactionId(),
    //     type: 'credit',
    //     amount: netAmount,
    //     netAmount,
    //     fees: 0,
    //     description: `Transfer from ${user.name} (${user.accountNumber})`,
    //     status: 'completed',
    //     category: 'transfer',
    //     sender: {
    //       userId: user._id,
    //       name: user.name,
    //       accountNumber: user.accountNumber
    //     },
    //     receiver: {
    //       userId: recipientExists._id,
    //       name: recipientExists.name,
    //       accountNumber: recipientExists.accountNumber
    //     },
    //     completedAt: new Date()
    //   });

    //   await recipientTransaction.save();
    // }

    res.json({
      success: transaction.status !== 'failed',
      message: `Transfer ${transaction.status}`,
      data: transaction,
      newBalance: user.balance
    });

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error processing transfer'
    });
  }
});

// Schedule transfer
router.post('/schedule', auth, [
  body('toAccount').notEmpty().trim(),
  body('amount').isFloat({ min: 0.01 }),
  body('scheduleDate').isISO8601(),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { toAccount, amount, scheduleDate, description } = req.body;

    const transaction = new Transaction({
      userId: req.user._id,
      transactionId: Transaction.generateTransactionId(),
      type: 'transfer',
      amount,
      netAmount: amount,
      description: description || `Scheduled transfer to ${toAccount}`,
      status: 'scheduled',
      category: 'transfer',
      sender: {
        userId: req.user._id,
        name: req.user.name,
        accountNumber: req.user.accountNumber
      },
      receiver: {
        name: 'External Account',
        accountNumber: toAccount
      },
      scheduledFor: new Date(scheduleDate),
      metadata: {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    await transaction.save();

    res.json({
      success: true,
      message: 'Transfer scheduled successfully',
      data: transaction
    });

  } catch (error) {
    console.error('Schedule transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error scheduling transfer'
    });
  }
});

// Cancel pending transaction
router.post('/:id/cancel', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findOne({
      _id: req.params.id,
      userId: req.user._id,
      status: 'pending'
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Pending transaction not found'
      });
    }

    transaction.status = 'cancelled';
    transaction.notes = 'Cancelled by user';
    await transaction.save();

    res.json({
      success: true,
      message: 'Transaction cancelled successfully',
      data: transaction
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error cancelling transaction'
    });
  }
});

module.exports = router;