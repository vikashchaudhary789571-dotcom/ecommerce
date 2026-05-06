import React from 'react';

export const Table = ({ children, className = '' }) => (
  <table className={`w-full text-sm text-left ${className}`}>{children}</table>
);

export const TableHeader = ({ children, className = '' }) => (
  <thead className={`text-xs text-slate-700 uppercase bg-slate-50 ${className}`}>{children}</thead>
);

export const TableRow = ({ children, className = '' }) => (
  <tr className={`bg-white border-b border-slate-200 hover:bg-slate-50 transition-colors ${className}`}>{children}</tr>
);

export const TableHead = ({ children, className = '' }) => (
  <th className={`px-6 py-3 font-semibold ${className}`}>{children}</th>
);

export const TableBody = ({ children, className = '' }) => (
  <tbody className={`${className}`}>{children}</tbody>
);

export const TableCell = ({ children, className = '' }) => (
  <td className={`px-6 py-4 ${className}`}>{children}</td>
);
