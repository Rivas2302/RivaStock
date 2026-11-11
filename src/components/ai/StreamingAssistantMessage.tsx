import { useEffect, useState, type MouseEvent } from 'react';
import { renderMarkdownSafe } from '../../lib/knowledge/markdown';

interface StreamingAssistantMessageProps {
  content: string;
  streaming?: boolean;
  activity?: string | null;
  className?: string;
  onNewText?: () => void;
}

async function renderChatMarkdown(markdown: string): Promise<string> {
  const safeHtml = await renderMarkdownSafe(markdown);
  const parsed = document.implementation.createHTMLDocument('');
  parsed.body.innerHTML = safeHtml;

  for (const link of parsed.body.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.classList.add('font-semibold', 'text-[var(--brand)]', 'underline');
  }
  for (const heading of parsed.body.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    heading.classList.add('my-3', 'font-bold', 'leading-tight');
  }
  for (const paragraph of parsed.body.querySelectorAll('p')) paragraph.classList.add('mb-3', 'last:mb-0');
  for (const list of parsed.body.querySelectorAll('ul')) list.classList.add('my-3', 'list-disc', 'pl-5');
  for (const list of parsed.body.querySelectorAll('ol')) list.classList.add('my-3', 'list-decimal', 'pl-5');
  for (const item of parsed.body.querySelectorAll('li')) item.classList.add('my-1');
  for (const quote of parsed.body.querySelectorAll('blockquote')) quote.classList.add('my-3', 'border-l-2', 'border-[var(--line-strong)]', 'pl-3');
  for (const code of parsed.body.querySelectorAll('code:not(pre code)')) code.classList.add('rounded', 'bg-[var(--surface-muted)]', 'px-1');
  for (const bold of parsed.body.querySelectorAll('strong')) bold.classList.add('font-bold');
  for (const table of parsed.body.querySelectorAll('table')) {
    const wrapper = parsed.createElement('div');
    wrapper.className = 'my-3 max-w-full overflow-x-auto [&_table]:min-w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--line)] [&_th]:border [&_th]:border-[var(--line)] [&_th]:bg-[var(--surface-muted)] [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.append(table);
  }
  for (const pre of parsed.body.querySelectorAll('pre')) {
    const wrapper = parsed.createElement('div');
    wrapper.className = 'chat-code-frame';
    const button = parsed.createElement('button');
    button.type = 'button';
    button.setAttribute('data-chat-copy-code', '');
    button.setAttribute('aria-label', 'Copiar código');
    button.textContent = 'Copiar código';
    button.className = 'mb-1 min-h-8 rounded-md border border-[var(--line)] px-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]';
    pre.classList.add('my-1', 'overflow-x-auto', 'rounded-xl', 'bg-[var(--surface-muted)]', 'p-3');
    pre.parentNode?.insertBefore(wrapper, pre);
    wrapper.append(button, pre);
  }
  return parsed.body.innerHTML;
}

export default function StreamingAssistantMessage({
  content,
  streaming = false,
  activity,
  className = '',
  onNewText,
}: StreamingAssistantMessageProps) {
  const [visibleLength, setVisibleLength] = useState(content.length);
  const [html, setHtml] = useState('');
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return;
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    if (!streaming || reducedMotion) {
      setVisibleLength(content.length);
      return;
    }
    setVisibleLength((current) => Math.min(current, content.length));
    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        const next = Math.min(content.length, current + 40);
        if (next >= content.length) window.clearInterval(timer);
        return next;
      });
    }, 16);
    return () => window.clearInterval(timer);
  }, [content, reducedMotion, streaming]);

  const visibleContent = content.slice(0, visibleLength);
  useEffect(() => {
    let active = true;
    void renderChatMarkdown(visibleContent).then((next) => { if (active) setHtml(next); })
      .catch(() => { if (active) setHtml(''); });
    return () => { active = false; };
  }, [visibleContent]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copyButton = target.closest<HTMLButtonElement>('[data-chat-copy-code]');
    if (copyButton) {
      const code = copyButton.parentElement?.querySelector('pre code')?.textContent
        ?? copyButton.parentElement?.querySelector('pre')?.textContent
        ?? '';
      const clipboard = navigator.clipboard;
      if (!clipboard) {
        copyButton.textContent = 'No disponible';
        return;
      }
      void clipboard.writeText(code).then(() => {
        copyButton.textContent = 'Copiado';
        window.setTimeout(() => { if (copyButton.isConnected) copyButton.textContent = 'Copiar código'; }, 1200);
      }).catch(() => { copyButton.textContent = 'No se pudo copiar'; });
      return;
    }
    if (streaming && visibleLength < content.length) setVisibleLength(content.length);
  };

  return <div className={`chat-markdown break-words text-sm leading-6 ${className}`.trim()} onClick={handleClick}>
    {html ? <div dangerouslySetInnerHTML={{ __html: html }}/> : <p className="whitespace-pre-wrap">{visibleContent}</p>}
    {streaming && activity && <p role="status" className="mt-2 inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
      <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[var(--brand)]"/>{activity}
    </p>}
    {onNewText && <button type="button" onClick={onNewText} className="mt-3 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)] shadow-sm">↓ Nuevo texto</button>}
  </div>;
}
