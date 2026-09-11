import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { UserType, Message as MessageType } from '../types'

interface MessageProps {
  message: MessageType
}

export const Message: React.FC<MessageProps> = ({ message }) => {
  const isUser = message.sender === UserType.USER

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="bg-slate-900 text-white px-5 py-3 rounded-2xl rounded-br-md max-w-xs md:max-w-md lg:max-w-lg shadow-sm">
          <div className="prose prose-invert prose-sm max-w-none text-sm break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start">
      <div className="bg-slate-50 text-slate-800 px-5 py-4 rounded-2xl rounded-bl-md max-w-xs md:max-w-md lg:max-w-2xl border border-slate-100 shadow-sm">
        <div className="prose prose-slate prose-sm max-w-none text-sm break-words">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
              ul: ({ children }) => <ul className="my-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="my-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              code: ({ children }) => (
                <code className="bg-slate-200 px-1.5 py-0.5 rounded text-xs font-mono">
                  {children}
                </code>
              ),
              pre: ({ children }) => (
                <pre className="bg-slate-100 p-3 rounded-lg overflow-x-auto my-2">{children}</pre>
              ),
            }}
          >
            {message.text}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
}
