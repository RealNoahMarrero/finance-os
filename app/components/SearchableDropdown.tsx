'use client';
import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X, Tag } from 'lucide-react';

interface Option {
    id: string | number;
    name: string;
    emoji?: string;
    group?: string;
}

interface SearchableDropdownProps {
    options: Option[];
    value: string | number;
    onChange: (value: string) => void;
    placeholder?: string;
    label?: string;
    icon?: React.ReactNode;
}

export default function SearchableDropdown({ options, value, onChange, placeholder = "Select...", label, icon }: SearchableDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.id.toString() === value?.toString());

    const filteredOptions = options.filter(opt => 
        opt.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
        (opt.group && opt.group.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={containerRef}>
            {label && <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">{icon} {label}</label>}
            
            <div 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full p-3 bg-slate-50 rounded-xl font-bold text-slate-900 border border-slate-100 outline-none focus-within:border-blue-300 focus-within:bg-white transition-all cursor-pointer flex items-center justify-between"
            >
                <div className="flex items-center gap-2 truncate">
                    {selectedOption ? (
                        <>
                            {selectedOption.emoji && <span>{selectedOption.emoji}</span>}
                            <span className="truncate">{selectedOption.name}</span>
                        </>
                    ) : (
                        <span className="text-slate-400">{placeholder}</span>
                    )}
                </div>
                <ChevronDown size={16} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </div>

            {isOpen && (
                <div className="absolute z-[60] mt-2 w-full bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95">
                    <div className="p-2 border-b border-slate-50 bg-slate-50/50 flex items-center gap-2">
                        <Search size={14} className="text-slate-400" />
                        <input 
                            autoFocus
                            type="text"
                            placeholder="Type to filter..."
                            className="bg-transparent w-full text-sm font-bold outline-none text-slate-800 placeholder-slate-400"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {searchTerm && <X size={14} className="text-slate-400 cursor-pointer hover:text-slate-600" onClick={() => setSearchTerm('')} />}
                    </div>
                    
                    <div className="max-h-60 overflow-y-auto hide-scrollbar py-1">
                        {filteredOptions.length > 0 ? (
                            filteredOptions.map((opt) => (
                                <div 
                                    key={opt.id}
                                    onClick={() => {
                                        onChange(opt.id.toString());
                                        setIsOpen(false);
                                        setSearchTerm('');
                                    }}
                                    className={`px-4 py-2.5 text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors ${value?.toString() === opt.id.toString() ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}
                                >
                                    {opt.emoji && <span>{opt.emoji}</span>}
                                    <span className="truncate">{opt.name}</span>
                                    {opt.group && <span className="text-[10px] bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded ml-auto uppercase tracking-tighter">{opt.group}</span>}
                                </div>
                            ))
                        ) : (
                            <div className="px-4 py-8 text-center text-xs font-bold text-slate-400">
                                No matching envelopes found.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
