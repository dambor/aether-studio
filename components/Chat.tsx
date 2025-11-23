import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, ToolHandler } from '../types';
import { sendMessageToGemini } from '../services/geminiService';
import { SendIcon, MessageSquareIcon, MicIcon, PaperclipIcon } from './Icons';

interface ChatProps {
    visible: boolean;
    toolHandler: ToolHandler;
}

// Add support for the Web Speech API types
declare global {
    interface Window {
        webkitSpeechRecognition: any;
        SpeechRecognition: any;
    }
}

const Chat: React.FC<ChatProps> = ({ visible, toolHandler }) => {
    const [input, setInput] = useState("");
    const [messages, setMessages] = useState<ChatMessage[]>([
        { role: 'model', text: 'Hello! I am your AI Agent. I can see what you write, and now I can see images and hear you too! Drag an image here or click the mic to speak.', timestamp: new Date() }
    ]);
    const [isTyping, setIsTyping] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [attachedImage, setAttachedImage] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if ((!input.trim() && !attachedImage) || isTyping) return;

        const currentImage = attachedImage;
        const userMsg: ChatMessage = { 
            role: 'user', 
            text: input, 
            timestamp: new Date(),
            image: currentImage || undefined
        };

        setMessages(prev => [...prev, userMsg]);
        setInput("");
        setAttachedImage(null);
        setIsTyping(true);

        const modelMsg: ChatMessage = { role: 'model', text: '', timestamp: new Date() };
        setMessages(prev => [...prev, modelMsg]);

        try {
            const stream = sendMessageToGemini(userMsg.text || "Analyze this image", toolHandler, currentImage || undefined);
            let fullText = "";
            let isFirstChunk = true;
            
            for await (const chunk of stream) {
                if (chunk.startsWith('[Agent')) {
                   fullText = chunk; 
                } else {
                    if (isFirstChunk && fullText.startsWith('[')) {
                        fullText = "";
                    }
                    fullText += chunk;
                }
                
                isFirstChunk = false;

                setMessages(prev => {
                    const newHistory = [...prev];
                    newHistory[newHistory.length - 1] = { ...modelMsg, text: fullText };
                    return newHistory;
                });
            }
        } catch (err) {
            setMessages(prev => [...prev, { role: 'model', text: 'Sorry, I encountered an error.', isError: true, timestamp: new Date() }]);
        } finally {
            setIsTyping(false);
        }
    };

    // --- Voice Input Logic ---
    const toggleListening = () => {
        if (isListening) return; // Basic implementation: stop is handled by 'end' event mostly

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("Your browser does not support voice input. Try Chrome.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';

        recognition.onstart = () => setIsListening(true);
        recognition.onend = () => setIsListening(false);
        
        recognition.onresult = (event: any) => {
            const transcript = event.results[0][0].transcript;
            setInput(prev => prev + (prev ? " " : "") + transcript);
        };

        recognition.start();
    };

    // --- Drag & Drop Logic ---
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = () => {
                setAttachedImage(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // Handle Paste (to support pasting screenshots)
    const handlePaste = (e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                const blob = items[i].getAsFile();
                if (blob) {
                    const reader = new FileReader();
                    reader.onload = () => setAttachedImage(reader.result as string);
                    reader.readAsDataURL(blob);
                }
            }
        }
    };

    if (!visible) return null;

    return (
        <div 
            className="h-full flex flex-col bg-ide-sidebar border-l border-ide-border w-[300px] sm:w-[350px] relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Drag Overlay */}
            {isDragging && (
                <div className="absolute inset-0 bg-ide-accent/20 border-2 border-dashed border-ide-accent z-50 flex items-center justify-center pointer-events-none backdrop-blur-sm">
                    <span className="text-white font-bold bg-ide-bg px-4 py-2 rounded">Drop Image Here</span>
                </div>
            )}

            {/* Header */}
            <div className="h-10 border-b border-ide-border flex items-center px-4 bg-ide-bg">
                <span className="text-xs font-bold uppercase tracking-wide flex items-center gap-2">
                    <MessageSquareIcon className="w-4 h-4 text-ide-accent" /> AI Agent
                </span>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 gap-4 flex flex-col">
                {messages.map((msg, idx) => (
                    <div 
                        key={idx} 
                        className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                        <div 
                            className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                                msg.role === 'user' 
                                    ? 'bg-ide-accent text-white' 
                                    : 'bg-ide-activity border border-ide-border text-ide-text'
                            } ${msg.isError ? 'border-red-500 text-red-200' : ''} ${msg.text.startsWith('[Agent') ? 'italic text-gray-400 border-dashed' : ''}`}
                        >
                            {/* Display Image if present */}
                            {msg.image && (
                                <img src={msg.image} alt="User upload" className="max-w-full rounded mb-2 border border-white/20" />
                            )}
                            {msg.text}
                        </div>
                        <span className="text-[10px] text-gray-500 mt-1 px-1">
                            {msg.role === 'user' ? 'You' : 'Gemini'}
                        </span>
                    </div>
                ))}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="p-3 border-t border-ide-border bg-ide-bg">
                {/* Image Preview */}
                {attachedImage && (
                    <div className="mb-2 flex items-center bg-ide-activity p-2 rounded relative">
                        <img src={attachedImage} alt="Preview" className="h-12 w-12 object-cover rounded mr-2" />
                        <span className="text-xs text-gray-400">Image attached</span>
                        <button 
                            onClick={() => setAttachedImage(null)}
                            className="absolute top-1 right-1 text-gray-500 hover:text-white"
                        >
                            ×
                        </button>
                    </div>
                )}

                <form onSubmit={handleSend} className="relative">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={handlePaste}
                        placeholder={isListening ? "Listening..." : "Ask (paste image or click mic)..."}
                        className={`w-full bg-ide-activity border border-ide-border rounded-md pl-3 pr-20 py-2 text-sm text-ide-text focus:outline-none focus:border-ide-accent ${isListening ? 'animate-pulse border-red-500' : ''}`}
                    />
                    
                    <div className="absolute right-2 top-2 flex gap-1">
                        <button
                            type="button"
                            onClick={toggleListening}
                            className={`p-1 hover:text-white transition-colors ${isListening ? 'text-red-500' : 'text-gray-400'}`}
                            title="Voice Input"
                        >
                            <MicIcon className="w-4 h-4" active={isListening} />
                        </button>
                         <button
                            type="button"
                            onClick={() => document.getElementById('hidden-file-input')?.click()}
                            className="p-1 text-gray-400 hover:text-white"
                            title="Attach Image"
                        >
                            <PaperclipIcon className="w-4 h-4" />
                        </button>
                        <button 
                            type="submit" 
                            disabled={isTyping}
                            className="p-1 text-gray-400 hover:text-white disabled:opacity-50"
                        >
                            <SendIcon className="w-4 h-4" />
                        </button>
                    </div>
                </form>
                
                {/* Hidden File Input for Paperclip */}
                <input 
                    type="file" 
                    id="hidden-file-input" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                            const reader = new FileReader();
                            reader.onload = () => setAttachedImage(reader.result as string);
                            reader.readAsDataURL(file);
                        }
                    }}
                />
            </div>
        </div>
    );
};

export default Chat;