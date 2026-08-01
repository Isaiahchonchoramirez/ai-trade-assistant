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

export default function Assistant({ symbol, range, engine, onEngineChange }) {
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

      {engine && <ConnectClaude engine={engine} onChange={onEngineChange} />}
    </div>
  )
}

/**
 * The engine footnote, plus an inline way to connect Claude.
 *
 * A packaged user has no shell to export an environment variable in, so the
 * key goes in here instead — verified against the API before it is kept, and
 * never sent back to the browser once stored.
 */
function ConnectClaude({ engine, onChange }) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const keyRef = useRef(null)

  useEffect(() => {
    if (open) keyRef.current?.focus()
  }, [open])

  const connect = async (e) => {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const status = await api.connectClaude(key.trim())
      setKey('')
      setOpen(false)
      onChange?.(status)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      onChange?.(await api.disconnectClaude())
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (engine.claude_available) {
    return (
      <p className="px-4 pb-2.5 text-[10.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
        {engine.detail}{' '}
        {engine.key_source === 'app' && (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="underline underline-offset-2 hover:opacity-80"
          >
            Disconnect
          </button>
        )}
      </p>
    )
  }

  return (
    <div className="px-4 pb-2.5">
      <p className="text-[10.5px] leading-snug" style={{ color: 'var(--ink-3)' }}>
        {engine.detail}{' '}
        {engine.can_connect && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-semibold underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
          >
            Connect Claude for conversational replies →
          </button>
        )}
      </p>

      {open && (
        <form onSubmit={connect} className="mt-2 rounded-lg p-2.5" style={{ background: 'var(--surface-2)' }}>
          <label className="block text-[10.5px] font-semibold" style={{ color: 'var(--ink-2)' }}>
            Paste an Anthropic API key
          </label>
          <div className="mt-1.5 flex gap-1.5">
            <input
              ref={keyRef}
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck="false"
              className="min-w-0 flex-1 rounded-md px-2 py-1.5 font-mono text-[11px] outline-none"
              style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)' }}
            />
            <button type="submit" className="btn btn-primary !px-2.5 !py-1 !text-[11px]" disabled={busy || !key.trim()}>
              {busy ? <Spinner size={11} /> : 'Connect'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setError(null); setKey('') }}
              className="btn !px-2 !py-1 !text-[11px]"
            >
              Cancel
            </button>
          </div>

          {error && (
            <p className="mt-1.5 text-[10.5px]" role="alert" style={{ color: 'var(--down)' }}>
              {error}
            </p>
          )}

          <p className="mt-1.5 text-[10px] leading-snug" style={{ color: 'var(--ink-3)' }}>
            Stored on this computer only, readable just by you — never sent anywhere but Anthropic.{' '}
            <a
              href={engine.console_url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2"
              style={{ color: 'var(--accent)' }}
            >
              Get a key
            </a>
          </p>
        </form>
      )}
    </div>
  )
}
