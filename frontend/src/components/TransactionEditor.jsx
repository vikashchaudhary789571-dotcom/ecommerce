import React, { useState, useEffect, useMemo } from 'react';
import { Plus, Trash2, Calendar, FileDown, ArrowRight, Save, Shield, FileText } from 'lucide-react';
import { Button } from './ui/Button';
import { Card, CardContent, CardHeader } from './ui/Card';
import { motion } from 'framer-motion';
import { statementService } from '../services/api';

export function TransactionEditor({ fileUrl }) {
    const [currentViewUrl, setCurrentViewUrl] = useState(fileUrl);

    // Sync currentViewUrl whenever fileUrl prop changes (after transformation)
    useEffect(() => {
        if (fileUrl) {
            setCurrentViewUrl(fileUrl);
        }
    }, [fileUrl]);

    return (
        <div className="w-full h-[calc(100vh-80px)] flex flex-col overflow-hidden bg-slate-50">
            {/* Action Bar */}
            <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex items-center justify-between shrink-0 shadow-sm z-20">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => window.dispatchEvent(new CustomEvent('nav-to-upload'))}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                        title="Back to Home"
                    >
                        <ArrowRight className="w-5 h-5 rotate-180" />
                    </button>
                    <div>
                        <h2 className="text-lg font-bold text-slate-900 leading-tight">Document Viewer</h2>
                        <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Preview Mode</p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => window.print()}
                        className="bg-brand-primary hover:bg-brand-primary/90"
                    >
                        <FileDown className="w-4 h-4 mr-1.5" /> Export / Print
                    </Button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* PDF Preview Pane - Now Full Width */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ width: "100%", opacity: 1 }}
                    className="h-full bg-slate-100 flex flex-col relative"
                >
                    <div className="absolute top-4 left-4 z-10">
                        <div className="bg-slate-800/90 backdrop-blur text-white px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg shadow-black/10">
                            <FileText className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Digital Statement</span>
                        </div>
                    </div>
                    <div className="flex-1 w-full overflow-hidden">
                        {currentViewUrl ? (
                            <iframe
                                src={`${currentViewUrl}#toolbar=0&navpanes=0&scrollbar=0`}
                                className="w-full h-full border-none bg-white"
                                key={currentViewUrl}
                                title="PDF Preview"
                            />
                        ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center bg-white">
                                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                    <Plus className="w-8 h-8 opacity-20" />
                                </div>
                                <p className="font-medium text-slate-600">No PDF Source</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            </div>
        </div>
    );
}

