import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Spinner } from './Primitives.jsx'

const SUGGESTIONS = [
  'Should I buy?',
  'Why that signal?',
  "What's my risk?",
  'How much should I buy?',
  'How has this done historically?',
  'What is RSI saying?',
]

/** Renders the responder's light markdown: `- ` bullets and *emphasis*. */
function AnswerBody({ text }) {
  const blocks = text.split('\n').filter((line) => line.trim() !== '')
  return (
    <div className="flex flex-col gap-1.5">
      {blocks.map((line, i) => {
        const bullet = line.startsWith('- ')
        const content = bullet ? line.slice(2) : line
        const parts = content.split(/(\*[^*]+\*)/g).map((part, j) =>
          part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
            <em key={j} className="font-semibold not-italic" style={{ color: 'var(--ink)' }}>
              {part.slice(1, -1)}
            </em>
          ) : (
            <span key={j}>{part}</span>
          ),
        )
        return (
          <p key={i} className={`text-[13px] leading-relaxed ${bullet ? 'pl-3.5 -indent-3.5' : ''}`}>
            {bullet && <span aria-hidden="true" style={{ color: 'var(--ink-3)' }}>•&nbsp;</span>}
            {parts}
          </p>
        )
      })}
    </div>
  )
}

export default function Assistant({ symbol, range, engine }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // A new symbol is a new conversation — stale context would be misleading.
  useEffect(() => {
    setMessages([])
    setError(null)
  }, [symbol])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const ask = async (question) => {
    const text = question.trim()
    if (!text || busy) return

    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: 'user', content: text }])
    setInput('')
    setBusy(true)
    setError(null)

    try {
      const res = await api.chat({ symbol, question: text, range, history })
      setMessages((m) => [...m, { role: 'assistant', content: res.answer, engine: res.engine }])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-[220px] flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !busy && (
          <div className="flex flex-col gap-3 pt-1">
            <p className="text-[13px] leading-relaxed" style={{ color: 'var(--ink-2)' }}>
              Ask about <strong style={{ color: 'var(--ink)' }}>{symbol}</strong>. Answers come from
              the same indicators, levels and backtest shown on this page — never from memory.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
                  style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', border: '1px solid var(--line)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p
                  className="max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-[13px]"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={i} style={{ color: 'var(--ink-2)' }}>
                <AnswerBody text={m.content} />
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-2 text-[12.5px]" style={{ color: 'var(--ink-3)' }}>
              <Spinner size={13} /> Reading the indicators…
            </div>
          )}

          {error && (
            <p className="text-[12.5px]" style={{ color: 'var(--down)' }} role="alert">
              {error}
            </p>
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
        className="flex items-center gap-2 border-t px-3 py-2.5"
        style={{ borderColor: 'var(--line)' }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Ask about ${symbol}…`}
          aria-label={`Ask a question about ${symbol}`}
          className="min-w-0 flex-1 rounded-[10px] px-3 py-2 text-[13px] outline-none"
          style={{ background: 'var(--surface-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>

      {engine && (
        <p className="px-4 pb-2.5 text-[10.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
          {engine.detail}
        </p>
      )}
    </div>
  )
}
