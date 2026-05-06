import React from 'react';

export function NavItem({ icon, label, active = false, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`
        flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 group text-sm font-medium
        ${active ? 'bg-brand-secondary text-white shadow-md' : 'text-white/60 hover:bg-white/5 hover:text-white'}
      `}
        >
            <div className={`${active ? 'text-white' : 'text-white/40 group-hover:text-white'}`}>
                {icon}
            </div>
            <span className="whitespace-nowrap">{label}</span>
        </button>
    );
}
