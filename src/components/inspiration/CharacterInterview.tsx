/**
 * CharacterInterview（P2.1-B M3）：角色采访面板（编辑器 rail「灵感」分组）
 * 角色选择 -> 多轮对话（流式）-> 结束生成摘要预览 -> 用户确认后写入角色卡
 * 完整对话存 interview_sessions 表，历史采访可回看
 */

import { useEffect, useRef, useState } from 'react';
import { Mic, Send, Square, Check, X, History, RotateCcw, Trash2 } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import {
  INTERVIEW_ANGLE_LABEL
} from '../../services/inspiration/types';
import type {
  InterviewAngle,
  InterviewMessage,
  InterviewSession,
  InterviewRecord
} from '../../services/inspiration/types';
import { notifyInspirationsChanged } from './StorySeedGenerator';
import type { Character } from '../../types';

type ViewMode =
  | { kind: 'setup' } // 未开始：选角色与角度
  | { kind: 'live' } // 采访进行中
  | { kind: 'ended' } // 已结束：摘要预览
  | { kind: 'history'; session: InterviewSession }; // 回看历史

export function CharacterInterview({ bookId }: { bookId: string }): JSX.Element {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [characterId, setCharacterId] = useState('');
  const [angle, setAngle] = useState<InterviewAngle>('childhood');
  const [view, setView] = useState<ViewMode>({ kind: 'setup' });
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [streamText, setStreamText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [abortRef, setAbortRef] = useState<AbortController | null>(null);
  const [record, setRecord] = useState<InterviewRecord | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [historyList, setHistoryList] = useState<InterviewSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void getAppContext()
      .characterService.list(bookId)
      .then((list) => {
        setCharacters(list);
        setCharacterId((cur) => (list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? '')));
      });
  }, [bookId]);

  useEffect(() => {
    void loadHistory();
  }, [characterId]);

  // 流式输出时自动滚到底部
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamText]);

  const loadHistory = async (): Promise<void> => {
    if (!characterId) {
      setHistoryList([]);
      return;
    }
    try {
      const list = await getAppContext().interviewService.listByCharacter(characterId);
      setHistoryList(list);
    } catch {
      setHistoryList([]);
    }
  };

  const character = characters.find((c) => c.id === characterId);
  /** 会话对应角色名（live/ended/history 均取自会话，避免与下拉选择错位） */
  const sessionCharacterName = characters.find((c) => c.id === session?.characterId)?.name;

  const start = async (): Promise<void> => {
    if (!characterId) {
      void toast.info('本书暂无角色卡，请先在「角色」面板创建');
      return;
    }
    setError('');
    try {
      const { interviewService } = getAppContext();
      const s = await interviewService.startSession(characterId, bookId, angle);
      setSession(s);
      setMessages([]);
      setQuestion('');
      setStreamText('');
      setRecord(null);
      setSummary('');
      setSaved(false);
      setShowHistory(false);
      setView({ kind: 'live' });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ask = async (): Promise<void> => {
    if (!session || !question.trim() || streaming) return;
    const q = question.trim();
    setQuestion('');
    setError('');
    // 提问立即显示
    setMessages((m) => [...m, { role: 'interviewer', content: q, timestamp: Date.now() }]);
    const controller = new AbortController();
    setAbortRef(controller);
    setStreaming(true);
    setStreamText('');
    try {
      const { interviewService } = getAppContext();
      for await (const chunk of interviewService.ask(session.id, q, controller.signal)) {
        if (chunk.delta) setStreamText((s) => s + chunk.delta);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (!aborted) setError(msg);
    } finally {
      setStreaming(false);
      setAbortRef(null);
      setStreamText('');
      // 从会话同步最新消息（ask 内部已落库）
      const { interviewService } = getAppContext();
      const s = await interviewService.getSession(session.id);
      if (s) {
        setSession(s);
        setMessages(s.messages);
      }
    }
  };

  const switchAngle = async (a: InterviewAngle): Promise<void> => {
    setAngle(a);
    if (!session || view.kind !== 'live') return;
    try {
      await getAppContext().interviewService.switchAngle(session.id, a);
      setSession({ ...session, angle: a });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const end = async (): Promise<void> => {
    if (!session) return;
    if (session.messages.length === 0) {
      // 空会话直接结束回初始态
      void getAppContext().interviewService.endSession(session.id);
      resetToSetup();
      return;
    }
    setError('');
    setSummarizing(true);
    setView({ kind: 'ended' });
    try {
      const { interviewService } = getAppContext();
      const rec = await interviewService.endSession(session.id);
      setRecord(rec);
      const sum = await interviewService.summarize(session.id);
      setSummary(sum);
    } catch (e) {
      setError(`摘要生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSummarizing(false);
    }
  };

  const saveToCharacter = async (): Promise<void> => {
    if (!session || !summary) return;
    try {
      await getAppContext().interviewService.saveSummaryToCharacter(session.id, summary);
      setSaved(true);
      notifyInspirationsChanged();
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const resetToSetup = (): void => {
    setSession(null);
    setMessages([]);
    setRecord(null);
    setSummary('');
    setSaved(false);
    setStreamText('');
    setView({ kind: 'setup' });
    void loadHistory();
  };

  const viewHistory = (s: InterviewSession): void => {
    setSession(s);
    setMessages(s.messages);
    setView({ kind: 'history', session: s });
    setShowHistory(false);
  };

  /** 删除历史采访记录（确认后执行；正回看该条时退回初始态） */
  const deleteSession = async (s: InterviewSession): Promise<void> => {
    const ok = await confirmDialog(
      `确认删除这条采访记录？（${s.messages.length} 条对话${
        s.savedToCharacter ? '；已写入角色卡的摘要不受影响' : ''
      }）`,
      '删除采访记录'
    );
    if (!ok) return;
    try {
      await getAppContext().interviewService.deleteSession(s.id);
      if (view.kind === 'history' && view.session.id === s.id) {
        resetToSetup();
      } else {
        void loadHistory();
      }
    } catch (e) {
      void toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
        <Mic size={15} className="text-violet-600" />
        <span className="text-sm font-medium">角色采访</span>
        {view.kind === 'live' && sessionCharacterName && (
          <span className="ml-auto truncate text-xs text-ink-500">
            正在采访：{sessionCharacterName}
          </span>
        )}
      </div>

      {/* 初始态：角色 + 角度选择 */}
      {view.kind === 'setup' && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 text-xs text-ink-500">
            AI 扮演书中角色回答你的提问，帮你从角色内部理解人物。采访记录不会自动写入角色卡。
          </div>
          <div className="mb-1 text-xs font-medium text-ink-600">选择角色</div>
          {characters.length === 0 ? (
            <div className="rounded border border-dashed border-ink-200 p-3 text-center text-xs text-ink-400">
              本书暂无角色卡，请先在「角色」面板创建
            </div>
          ) : (
            <select
              value={characterId}
              onChange={(e) => setCharacterId(e.target.value)}
              className="mb-3 w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <div className="mb-1 text-xs font-medium text-ink-600">采访角度</div>
          <select
            value={angle}
            onChange={(e) => setAngle(e.target.value as InterviewAngle)}
            className="mb-3 w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400"
          >
            {(Object.keys(INTERVIEW_ANGLE_LABEL) as InterviewAngle[]).map((a) => (
              <option key={a} value={a}>
                {INTERVIEW_ANGLE_LABEL[a]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!characterId}
            className="w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void start()}
          >
            开始采访
          </button>

          {/* 历史采访 */}
          {characterId && historyList.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex w-full items-center gap-1 text-xs text-ink-500 hover:text-ink-800"
              >
                <History size={12} />
                历史采访（{historyList.length}）
              </button>
              {showHistory && (
                <div className="mt-1 space-y-1">
                  {historyList.map((s) => (
                    <div
                      key={s.id}
                      className="group flex items-stretch gap-1 rounded border border-ink-200 bg-white text-xs hover:border-violet-300 hover:bg-violet-50"
                    >
                      <button
                        type="button"
                        onClick={() => viewHistory(s)}
                        className="min-w-0 flex-1 px-2 py-1.5 text-left"
                      >
                        <div className="flex justify-between">
                          <span>{INTERVIEW_ANGLE_LABEL[s.angle]}</span>
                          <span className="text-ink-400">
                            {new Date(s.startedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="mt-0.5 text-ink-400">
                          {s.messages.length} 条对话
                          {s.savedToCharacter ? ' · 已写入角色卡' : ''}
                          {s.endedAt ? '' : ' · 未结束'}
                        </div>
                      </button>
                      <button
                        type="button"
                        title="删除该条采访记录"
                        onClick={() => void deleteSession(s)}
                        className="shrink-0 px-2 text-ink-300 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 采访进行中 */}
      {view.kind === 'live' && session && (
        <>
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-1.5">
            <select
              value={session.angle}
              onChange={(e) => void switchAngle(e.target.value as InterviewAngle)}
              disabled={streaming}
              className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-violet-400 disabled:opacity-50"
            >
              {(Object.keys(INTERVIEW_ANGLE_LABEL) as InterviewAngle[]).map((a) => (
                <option key={a} value={a}>
                  角度：{INTERVIEW_ANGLE_LABEL[a]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void end()}
              disabled={streaming}
              className="ml-auto rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40"
            >
              结束采访
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {messages.length === 0 && !streamText && (
              <div className="rounded bg-ink-50 p-2 text-xs text-ink-500">
                向{sessionCharacterName ?? '角色'}提问吧，例如：「你小时候最怕什么？」
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} name={sessionCharacterName} content={m.content} />
            ))}
            {(streamText || streaming) && (
              <MessageBubble
                role="character"
                name={sessionCharacterName}
                content={streamText || '…'}
                live={streaming}
              />
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="border-t border-ink-200 p-2">
            <div className="flex gap-1">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void ask();
                  }
                }}
                placeholder="输入采访问题…"
                disabled={streaming}
                className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400 disabled:opacity-50"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={() => abortRef?.abort()}
                  className="rounded bg-red-500 px-2 py-1 text-white hover:bg-red-600"
                  title="停止生成"
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!question.trim()}
                  onClick={() => void ask()}
                  className="rounded bg-violet-600 px-2 py-1 text-white hover:bg-violet-700 disabled:opacity-40"
                  title="发送"
                >
                  <Send size={14} />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* 已结束：摘要预览 */}
      {view.kind === 'ended' && session && (
        <div className="flex-1 overflow-y-auto p-3">
          {summarizing ? (
            <div className="py-10 text-center text-sm text-ink-400" data-status="generating">
              正在生成采访摘要…
            </div>
          ) : (
            <>
              <div className="mb-2 rounded bg-ink-50 p-2 text-xs text-ink-500">
                采访结束（{record?.messageCount ?? session.messages.length} 条对话）。
                {saved ? '摘要已写入角色卡。' : '确认后摘要才会写入角色卡，完整对话已存档可回看。'}
              </div>
              <div className="rounded-lg border border-ink-200 bg-white p-3">
                <div className="mb-1 text-xs font-medium text-violet-700">采访摘要预览</div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                  {summary || '（摘要生成失败，可放弃后重新采访）'}
                </p>
              </div>
              <div className="mt-3 flex gap-2">
                {saved ? (
                  <button
                    type="button"
                    onClick={resetToSetup}
                    className="flex flex-1 items-center justify-center gap-1 rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700"
                  >
                    <RotateCcw size={13} />
                    开始新采访
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={!summary}
                      onClick={() => void saveToCharacter()}
                      className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-600 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-40"
                    >
                      <Check size={13} />
                      添加到角色卡
                    </button>
                    <button
                      type="button"
                      onClick={resetToSetup}
                      className="flex items-center justify-center gap-1 rounded border border-ink-200 px-3 py-1.5 text-sm text-ink-500 hover:bg-ink-100"
                    >
                      <X size={13} />
                      放弃
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* 历史回看 */}
      {view.kind === 'history' && (
        <>
          <div className="flex items-center gap-2 border-b border-ink-100 px-3 py-1.5">
            <span className="text-xs text-ink-500">
              历史采访 · {INTERVIEW_ANGLE_LABEL[view.session.angle]}
            </span>
            <button
              type="button"
              onClick={resetToSetup}
              className="ml-auto rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100"
            >
              返回
            </button>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {view.session.messages.length === 0 && (
              <div className="text-center text-xs text-ink-400">该场采访无对话记录</div>
            )}
            {view.session.messages.map((m, i) => (
              <MessageBubble key={i} role={m.role} name={sessionCharacterName} content={m.content} />
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="m-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  role,
  name,
  content,
  live
}: {
  role: 'interviewer' | 'character';
  name?: string;
  content: string;
  live?: boolean;
}): JSX.Element {
  if (role === 'interviewer') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-violet-600 px-2.5 py-1.5 text-sm text-white">
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-800">
        {name && <div className="mb-0.5 text-[11px] font-medium text-violet-700">{name}{live ? ' 回答中…' : ''}</div>}
        <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
      </div>
    </div>
  );
}
