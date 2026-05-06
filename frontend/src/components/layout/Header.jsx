import React, { useState } from 'react';
import { RefreshCw, LogOut, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { NavItem } from './NavItem';

export function Header({ navItems, onLogout }) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <>
            <header className="h-20 bg-brand-primary text-white border-b border-white/5 flex items-center justify-between px-4 md:px-8 sticky top-0 z-50">
                <div className="flex items-center gap-4 md:gap-10">
                    {/* Mobile Menu Toggle */}
                    <button
                        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                        className="lg:hidden w-10 h-10 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
                    >
                        {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
                    </button>

                    <div className="flex items-center gap-3 md:pr-6 md:border-r md:border-white/10">
                        <div className="w-8 h-8 md:w-10 md:h-10 bg-brand-secondary rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
                            <RefreshCw className="w-5 h-5 md:w-6 md:h-6 text-white" />
                        </div>
                        <span className="font-bold text-lg md:text-xl tracking-tight hidden xs:block">FinReconstruct</span>
                    </div>

                    {/* Desktop Navigation */}
                    <nav className="hidden lg:flex items-center gap-1">
                        {navItems.map((item) => (
                            <NavItem
                                key={item.id}
                                icon={item.icon}
                                label={item.label}
                                active={item.active}
                                onClick={item.action}
                            />
                        ))}
                    </nav>
                </div>

                <div className="flex items-center gap-4">
                    <button
                        onClick={onLogout}
                        className="flex items-center gap-2 px-3 py-1.5 md:px-4 md:py-2 bg-white/5 hover:bg-white/10 text-white/80 hover:text-white rounded-lg text-xs md:text-sm font-medium transition-all border border-white/10"
                    >
                        <LogOut className="w-4 h-4" />
                        <span className="hidden xs:inline">Log out</span>
                    </button>
                </div>
            </header>

            {/* Mobile Menu Modal/Overlay */}
            <AnimatePresence>
                {isMobileMenuOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[51] lg:hidden"
                        />
                        <motion.div
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="fixed top-0 left-0 bottom-0 w-[280px] bg-brand-primary text-white z-[52] lg:hidden shadow-2xl flex flex-col"
                        >
                            <div className="p-6 flex items-center gap-3 border-b border-white/10">
                                <div className="w-10 h-10 bg-brand-secondary rounded-xl flex items-center justify-center">
                                    <RefreshCw className="w-6 h-6 text-white" />
                                </div>
                                <span className="font-bold text-xl tracking-tight">FinReconstruct</span>
                            </div>

                            <nav className="flex-1 p-4 space-y-2">
                                {navItems.map((item) => (
                                    <button
                                        key={item.id}
                                        onClick={() => {
                                            item.action();
                                            setIsMobileMenuOpen(false);
                                        }}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${item.active ? 'bg-brand-secondary text-white shadow-lg' : 'text-white/60 hover:bg-white/5'
                                            }`}
                                    >
                                        {item.icon}
                                        <span className="font-medium text-sm">{item.label}</span>
                                    </button>
                                ))}
                            </nav>

                            <div className="p-4 border-t border-white/10">
                                <button
                                    onClick={() => {
                                        onLogout();
                                        setIsMobileMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:bg-red-500/10 transition-all font-medium"
                                >
                                    <LogOut className="w-4 h-4" />
                                    Sign Out
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
