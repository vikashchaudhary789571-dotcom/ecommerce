const User = require('../models/userModel');
const jwt = require('jsonwebtoken');

const signToken = (id) => {
    const secret = process.env.JWT_SECRET || 'fallback-secret-key-for-demo';
    return jwt.sign({ id }, secret, {
        expiresIn: '30d'
    });
};

const createSendToken = (user, statusCode, res) => {
    const token = signToken(user._id);
    
    // Remove password from output
    user.password = undefined;

    res.status(statusCode).json({
        success: true,
        token,
        user
    });
};

exports.register = async (req, res) => {
    try {
        const { name, email, password } = req.body;

        // Always use dummy registration for demo
        console.log('[register] Using dummy registration');
        
        const token = signToken('dummy-user-id');
        return res.status(201).json({
            success: true,
            token,
            user: {
                _id: 'dummy-user-id',
                name: name || 'Demo User',
                email: email,
                role: 'user'
            },
            message: 'Registration successful. Use demo@example.com / demo123 to login'
        });
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error. Please try again.'
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        console.log('[login] Request received:', { email, hasPassword: !!password });

        // 1) Check if email and password exist
        if (!email || !password) {
            console.log('[login] Missing credentials');
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // 2) Always use dummy authentication for demo
        // This avoids MongoDB timeout issues on Render
        console.log('[login] Using dummy authentication');
        
        if (email === 'demo@example.com' && password === 'demo123') {
            console.log('[login] Demo credentials matched');
            const token = signToken('dummy-user-id');
            return res.status(200).json({
                success: true,
                token,
                user: {
                    _id: 'dummy-user-id',
                    name: 'Demo User',
                    email: email,
                    role: 'user'
                }
            });
        } else {
            console.log('[login] Invalid credentials provided:', email);
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials. Use: demo@example.com / demo123'
            });
        }
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({
            success: false,
            message: 'Server error. Please try again.'
        });
    }
};
