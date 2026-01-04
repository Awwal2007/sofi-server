const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const userModel = require('../models/user');
const { auth } = require('../middleware/auth');

// Register new user
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().notEmpty(),
  body('phone').trim().notEmpty(),
  body('dateOfBirth').isISO8601(),
  body('ssn').trim().notEmpty()
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password, name, phone, dateOfBirth, ssn, address } = req.body;

    // Check if user already exists
    let user = await userModel.findOne({ 
      $or: [{ email }, { ssn }] 
    });

    if (user) {
      return res.status(400).json({
        success: false,
        message: 'User already exists with this email or SSN'
      });
    }

    // Generate account number
    const accountNumber = await userModel.generateAccountNumber();

    // Create new user
    user = new userModel({
      accountNumber,
      email,
      password,
      name,
      phone,
      dateOfBirth: new Date(dateOfBirth),
      ssn,
      address,
      balance: 1000, // Initial deposit for demo
      accountType: 'checking'
    });

    await user.save();

    // Create initial deposit transaction
    const transactionModel = require('../models/transaction');
    const initialTransaction = new transactionModel({
      userId: user._id,
      transactionId: transactionModel.generateTransactionId(),
      type: 'credit',
      amount: 1000,
      description: 'Initial Account Opening Deposit',
      status: 'completed',
      category: 'deposit',
      sender: {
        name: 'Bank System',
        accountNumber: 'SYSTEM001'
      },
      receiver: {
        name: user.name,
        accountNumber: user.accountNumber
      },
      netAmount: 1000
    });

    await initialTransaction.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// Login user
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Find user
    const user = await userModel.findOne({ email }).select('+password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: user.toJSON()
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      success: true,
      user: req.user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Change password
router.post('/change-password', auth, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await userModel.findById(req.user._id).select('+password');

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', auth, async (req, res) => {
  // In a real app, you might want to implement token blacklisting
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;