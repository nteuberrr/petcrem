'use client'
/* eslint-disable @next/next/no-img-element */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Renderiza el texto del agente (markdown) con un estilo prolijo y compacto para
 * el chat: títulos, tablas, listas, negritas, citas e imágenes — en vez de mostrar
 * los símbolos en crudo. Paleta de marca Alma Animal (azul #143C64, dorado #F2B84B).
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-gray-800 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-base font-bold text-[#143C64] mt-3 mb-1.5 first:mt-0">{children}</h3>,
          h2: ({ children }) => <h3 className="text-sm font-bold text-[#143C64] uppercase tracking-wide mt-3 mb-1.5 first:mt-0">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-semibold text-gray-900 mt-2.5 mb-1 first:mt-0">{children}</h4>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="marker:text-[#F2B84B]">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
          em: ({ children }) => <em className="text-gray-700">{children}</em>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-[#2a6db0] font-medium underline underline-offset-2">{children}</a>,
          blockquote: ({ children }) => <blockquote className="border-l-4 border-[#F2B84B] bg-amber-50/60 pl-3 pr-2 py-1.5 my-2 rounded-r text-gray-700">{children}</blockquote>,
          hr: () => <hr className="my-3 border-gray-300" />,
          code: ({ children }) => <code className="bg-gray-100 text-[#143C64] rounded px-1 py-0.5 text-[12px] font-mono">{children}</code>,
          table: ({ children }) => <div className="overflow-x-auto my-2 rounded-lg border border-gray-300"><table className="w-full text-xs">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-[#143C64] text-white">{children}</thead>,
          th: ({ children }) => <th className="text-left px-2.5 py-1.5 font-semibold whitespace-nowrap">{children}</th>,
          td: ({ children }) => <td className="px-2.5 py-1.5 border-t border-gray-300 align-top">{children}</td>,
          img: ({ src, alt }) => (typeof src === 'string' && src)
            ? (
              <span className="relative inline-block my-2 align-top group/img">
                <img src={src} alt={alt || ''} className="block rounded-lg border border-gray-300 max-w-full max-h-72 object-contain" />
                <a
                  href={`/api/mailing/imagenes/descargar?url=${encodeURIComponent(src)}`}
                  download
                  title="Descargar imagen"
                  className="absolute top-1.5 right-1.5 bg-white/90 hover:bg-white border border-gray-300 rounded-md px-1.5 py-1 text-xs text-gray-700 shadow-sm leading-none opacity-90 md:opacity-0 md:group-hover/img:opacity-100 transition"
                >⬇</a>
              </span>
            )
            : null,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
