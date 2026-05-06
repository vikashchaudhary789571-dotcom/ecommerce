import React, { useState } from 'react';
import { RefreshCw, Lock, Mail, ArrowRight, Eye, EyeOff, ShieldCheck, User } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardContent } from './ui/Card';
import { motion, AnimatePresence } from 'framer-motion';

import { authService } from '../services/api';

export function LoginPage({ onLogin }) {
    const [mode, setMode] = useState('login'); // 'login' or 'register'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        setError('');

        try {
            let data;
            if (mode === 'login') {
                data = await authService.login(email, password);
            } else {
                data = await authService.register(name, email, password);
            }

            if (data.success) {
                // Save full auth data including token
                localStorage.setItem('fin_auth', 'true');
                localStorage.setItem('fin_auth_data', JSON.stringify(data));
                onLogin(data);
            } else {
                setError(data.message || (mode === 'login' ? 'Invalid credentials' : 'Registration failed'));
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Server connection failed. Please check if backend is running.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 relative overflow-hidden px-4">
            {/* Background Decorative Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-100/50 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-100/50 rounded-full blur-[120px]" />
            </div>

            <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-[380px]"
            >
                <div className="text-center mb-6">
                    <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
                        {mode === 'login' ? 'Sign In' : 'Create Account'}
                    </h1>
                    <p className="text-slate-400 text-[13px] mt-1.5 px-4 font-medium">
                        {mode === 'login' ? 'Welcome back to your home' : 'Start your document journey with us'}
                    </p>
                </div>

                <Card className="border-slate-200/60 shadow-xl shadow-slate-200/40 rounded-2xl overflow-hidden bg-white/80 backdrop-blur-sm">
                    <CardContent className="p-6 md:p-7">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <AnimatePresence mode="wait">
                                {mode === 'register' && (
                                    <motion.div
                                        key="register-fields"
                                        initial={{ opacity: 0, scale: 0.95 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 0.95 }}
                                        className="space-y-1.5"
                                    >
                                        <label className="text-xs font-bold text-slate-600 ml-0.5">Full Name</label>
                                        <div className="relative group">
                                            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                                                <User className="w-4 h-4" />
                                            </div>
                                            <input
                                                type="text"
                                                required={mode === 'register'}
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                placeholder="Enter your name"
                                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500/80 transition-all placeholder:text-slate-300"
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-slate-600 ml-0.5">Email Address</label>
                                <div className="relative group">
                                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                                        <Mail className="w-4 h-4" />
                                    </div>
                                    <input
                                        type="email"
                                        required
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="name@company.com"
                                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500/80 transition-all placeholder:text-slate-300"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <div className="flex justify-between items-center ml-0.5">
                                    <label className="text-xs font-bold text-slate-600">Password</label>
                                    {mode === 'login' && (
                                        <a href="#" className="text-[10px] uppercase tracking-wider font-bold text-blue-600 hover:text-blue-700">Forgot?</a>
                                    )}
                                </div>
                                <div className="relative group">
                                    <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-600 transition-colors">
                                        <Lock className="w-4 h-4" />
                                    </div>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        required
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200/80 rounded-lg text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/5 focus:border-blue-500/80 transition-all placeholder:text-slate-300"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full flex justify-center py-3 text-sm font-bold mt-2 shadow-lg shadow-blue-500/20"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Processing...
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5">
                                        {mode === 'login' ? 'Sign In' : 'Sign Up'} 
                                        <ArrowRight className="w-4 h-4" />
                                    </div>
                                )}
                            </Button>

                            {error && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="bg-red-50 text-red-500 p-2.5 rounded-lg text-[11px] font-bold border border-red-100 mt-2 text-center"
                                >
                                    {error}
                                </motion.div>
                            )}
                        </form>

                        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-center gap-1.5 text-slate-300 text-[10px] font-bold tracking-widest uppercase">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            Encrypted & Secure
                        </div>
                    </CardContent>
                </Card>

                <p className="text-center mt-6 text-slate-400 text-xs font-medium">
                    {mode === 'login' ? "New here?" : "Already have an account?"} {' '}
                    <button 
                        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                        className="text-blue-600 font-bold hover:text-blue-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                    >
                        {mode === 'login' ? 'Create Account' : 'Sign In Now'}
                    </button>
                </p>
            </motion.div>
        </div>
    );
}
