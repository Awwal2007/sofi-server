const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/user');
const Transaction = require('../models/transaction');

// Get account dashboard data
router.get('/dashboard', auth, async (req, res) => {
  try {
    const user = req.user;
    
    // Get recent transactions
    const recentTransactions = await Transaction.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(5);
    
    // Get transaction statistics
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentStats = await Transaction.aggregate([
      {
        $match: {
          userId: user._id,
          createdAt: { $gte: thirtyDaysAgo },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalSpent: {
            $sum: {
              $cond: [{ $eq: ['$type', 'debit'] }, '$amount', 0]
            }
          },
          totalReceived: {
            $sum: {
              $cond: [{ $eq: ['$type', 'credit'] }, '$amount', 0]
            }
          },
          transactionCount: { $sum: 1 }
        }
      }
    ]);

    const dashboardData = {
      user: user.toJSON(),
      balance: user.balance,
      accountNumber: user.accountNumber,
      recentTransactions,
      stats: recentStats[0] || {
        totalSpent: 0,
        totalReceived: 0,
        transactionCount: 0
      },
      creditScore: 750, // This would come from a credit bureau API
      netWorth: user.balance
    };

    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching dashboard data'
    });
  }
});

// Get account details
router.get('/details', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      data: req.user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Update account details
router.put('/update', auth, async (req, res) => {
  try {
    const updates = req.body;
    const allowedUpdates = ['name', 'phone', 'address', 'email'];
    
    // Filter only allowed updates
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        req.user[key] = updates[key];
      }
    });

    req.user.updatedAt = new Date();
    await req.user.save();

    res.json({
      success: true,
      message: 'Account updated successfully',
      user: req.user
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error updating account'
    });
  }
});

// Get account statement
router.get('/statement', auth, async (req, res) => {
  try {
    const { startDate, endDate, format = 'json' } = req.query;
    
    let query = { userId: req.user._id };
    
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 });

    const statementData = {
      user: {
        name: req.user.name,
        accountNumber: req.user.accountNumber,
        email: req.user.email
      },
      period: {
        startDate: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: endDate || new Date()
      },
      openingBalance: 0, // Would need to calculate from previous period
      closingBalance: req.user.balance,
      transactions,
      summary: {
        totalCredits: transactions
          .filter(t => t.type === 'credit' && t.status === 'completed')
          .reduce((sum, t) => sum + t.amount, 0),
        totalDebits: transactions
          .filter(t => t.type === 'debit' && t.status === 'completed')
          .reduce((sum, t) => sum + t.amount, 0),
        totalFees: transactions
          .reduce((sum, t) => sum + (t.fees || 0), 0)
      }
    };

    if (format === 'pdf') {
      // Generate PDF statement
      // This would use a PDF generation library like pdfkit
      return res.json({
        success: true,
        message: 'PDF generation would happen here',
        data: statementData
      });
    }

    res.json({
      success: true,
      data: statementData
    });

  } catch (error) {
    console.error('Statement error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error generating statement'
    });
  }
});

module.exports = router;