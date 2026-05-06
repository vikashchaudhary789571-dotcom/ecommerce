import React from 'react';

export function FeatureCard({ icon, title, description }) {
    return (
        <div className="p-6 md:p-8 bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
            <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-slate-50 flex items-center justify-center mb-4 md:mb-6 group-hover:scale-110 transition-transform">
                {icon}
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2 md:mb-3">{title}</h3>
            <p className="text-slate-500 text-sm leading-relaxed">
                {description}
            </p>
        </div>
    );
}
