const User = require('../models/userModel');
const jwt = require('jsonwebtoken');

const signToken = (id) => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET must be defined in .env file');
    }
    return jwt.sign({ id }, process.env.JWT_SECRET, {
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

        // If MongoDB is not connected, use dummy registration
        if (!process.env.MONGO_URI) {
            console.log('[register] No database configured, using dummy registration');
            
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
                message: 'Demo mode: Registration successful. Use demo@example.com / demo123 to login'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'Email already exists'
            });
        }

        const newUser = await User.create({
            name,
            email,
            password,
            role: 'user' // Force user role for all signups
        });

        createSendToken(newUser, 201, res);
    } catch (err) {
        console.error('Registration Error:', err);
        res.status(500).json({
            success: false,
            message: 'Error creating user: ' + err.message
        });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // 1) Check if email and password exist
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        // 2) If MongoDB is not connected, use dummy authentication
        if (!process.env.MONGO_URI) {
            console.log('[login] No database configured, using dummy auth');
            
            // Dummy authentication for demo purposes
            if (email === 'demo@example.com' && password === 'demo123') {
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
                return res.status(401).json({
                    success: false,
                    message: 'Incorrect email or password. Try: demo@example.com / demo123'
                });
            }
        }

        // 3) Check if user exists & password is correct (with database)
        const user = await User.findOne({ email }).select('+password');

        if (!user || !(await user.correctPassword(password, user.password))) {
            return res.status(401).json({
                success: false,
                message: 'Incorrect email or password'
            });
        }

        // 4) If everything ok, send token to client
        createSendToken(user, 200, res);
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).json({
            success: false,
            message: 'Error logging in: ' + err.message
        });
    }
};
