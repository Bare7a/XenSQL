import {
  Bookmark,
  Check,
  ChevronDown,
  CircleAlert,
  Clock,
  Gauge,
  GitBranch,
  Pencil,
  Play,
  PlayCircle,
  Route,
  Square,
  X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@/shared/components/ContextMenu';
import { formatBinding, getEffectiveBinding } from '@/shared/lib/shortcuts';
import type { TxnState } from '@/types';

interface Props {
  isQueryRunning: boolean;
  onCancelQuery?: () => void;
  runQuery: (selectedOnly: boolean) => void;
  explainQuery?: (analyze: boolean) => void;
  canAnalyze?: boolean;
  onSaveQuery?: () => void;
  onRenameSavedQuery?: () => void;
  savedQueryId?: string;
  txnState?: TxnState;
  onBeginTxn?: () => void;
  onCommitTxn?: () => void;
  onRollbackTxn?: () => void;
}

export function EditorToolbar({
  isQueryRunning,
  onCancelQuery,
  runQuery,
  explainQuery,
  canAnalyze = false,
  onSaveQuery,
  onRenameSavedQuery,
  savedQueryId,
  txnState,
  onBeginTxn,
  onCommitTxn,
  onRollbackTxn,
}: Props) {
  const { t } = useTranslation();
  const inTxn = txnState === 'active' || txnState === 'error';
  const explainMenuRef = useRef<HTMLButtonElement>(null);
  const [explainMenu, setExplainMenu] = useState<{ x: number; y: number } | null>(null);

  const openExplainMenu = () => {
    const rect = explainMenuRef.current?.getBoundingClientRect();
    if (!rect) return;
    setExplainMenu({ x: rect.left, y: rect.bottom + 2 });
  };

  return (
    <div className="toolbar">
      {isQueryRunning && onCancelQuery ? (
        <button
          type="button"
          className="btn btn-sm btn-stop"
          onClick={onCancelQuery}
          data-tooltip={t('tooltip.stopQuery')}
        >
          <Square className="icon-sm" fill="currentColor" /> {t('editor.stop')}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => runQuery(true)}
            data-tooltip={t('tooltip.runSelection', {
              shortcut: formatBinding(getEffectiveBinding('runSelection')),
            })}
          >
            <Play className="icon-sm" /> {t('editor.run')}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => runQuery(false)}
            data-tooltip={t('tooltip.runAll', {
              shortcut: formatBinding(getEffectiveBinding('runAll')),
            })}
          >
            <PlayCircle className="icon-sm" /> {t('editor.runAll')}
          </button>
          {explainQuery && (
            <span className="btn-split">
              <button
                type="button"
                className="btn btn-sm btn-split-main"
                onClick={() => explainQuery(false)}
                data-tooltip={t('tooltip.explain', {
                  shortcut: formatBinding(getEffectiveBinding('explainQuery')),
                })}
              >
                <Route className="icon-sm" /> {t('editor.explain')}
              </button>
              {canAnalyze && (
                <button
                  ref={explainMenuRef}
                  type="button"
                  className="btn btn-sm btn-split-more"
                  onClick={openExplainMenu}
                  aria-haspopup="menu"
                  aria-expanded={explainMenu != null}
                  aria-label={t('editor.explainOptions')}
                  data-tooltip={t('tooltip.explainOptions', {
                    shortcut: formatBinding(getEffectiveBinding('explainAnalyze')),
                  })}
                >
                  <ChevronDown className="icon-xs" />
                </button>
              )}
            </span>
          )}
        </>
      )}
      {onSaveQuery && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onSaveQuery}
          data-tooltip={
            savedQueryId
              ? t('tooltip.updateSavedQuery', {
                  shortcut: formatBinding(getEffectiveBinding('saveQuery')),
                })
              : t('tooltip.saveQuery', {
                  shortcut: formatBinding(getEffectiveBinding('saveQuery')),
                })
          }
        >
          <Bookmark className="icon-sm" /> {savedQueryId ? t('editor.update') : t('editor.save')}
        </button>
      )}
      {savedQueryId && onRenameSavedQuery && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRenameSavedQuery}
          data-tooltip={t('tooltip.renameSavedQuery', {
            shortcut: formatBinding(getEffectiveBinding('renameSavedQuery')),
          })}
        >
          <Pencil className="icon-sm" /> {t('editor.rename')}
        </button>
      )}
      {onBeginTxn && !inTxn && (
        <button
          type="button"
          className="btn btn-sm"
          onClick={onBeginTxn}
          disabled={isQueryRunning}
          data-tooltip={t('tooltip.beginTxn')}
        >
          <GitBranch className="icon-sm" /> {t('editor.beginTxn')}
        </button>
      )}
      {inTxn && (
        <>
          <span
            className={`toolbar-txn-badge ${txnState === 'error' ? 'toolbar-txn-badge-error' : ''}`}
            data-tooltip={txnState === 'error' ? t('tooltip.txnError') : t('tooltip.txnActive')}
          >
            {txnState === 'error' ? (
              <CircleAlert className="icon-sm toolbar-txn-icon" />
            ) : (
              <Clock className="icon-sm toolbar-txn-icon" />
            )}
            {txnState === 'error' ? t('editor.txnError') : t('editor.txnActive')}
          </span>
          {onCommitTxn && (
            <button
              type="button"
              className="btn btn-sm btn-txn-commit"
              onClick={onCommitTxn}
              disabled={isQueryRunning}
              data-tooltip={t('tooltip.commitTxn')}
            >
              <Check className="icon-sm" /> {t('editor.commitTxn')}
            </button>
          )}
          {onRollbackTxn && (
            <button
              type="button"
              className="btn btn-sm btn-txn-rollback"
              onClick={onRollbackTxn}
              disabled={isQueryRunning}
              data-tooltip={t('tooltip.rollbackTxn')}
            >
              <X className="icon-sm" /> {t('editor.rollbackTxn')}
            </button>
          )}
        </>
      )}
      {explainMenu && explainQuery && (
        <ContextMenu
          x={explainMenu.x}
          y={explainMenu.y}
          onClose={() => setExplainMenu(null)}
          items={[
            {
              label: t('editor.explain'),
              icon: <Route className="icon-xs" />,
              action: () => explainQuery(false),
            },
            {
              label: t('editor.explainAnalyze'),
              icon: <Gauge className="icon-xs" />,
              action: () => explainQuery(true),
            },
          ]}
        />
      )}
    </div>
  );
}
