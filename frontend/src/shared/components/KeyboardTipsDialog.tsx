import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { formatBinding, getEffectiveBinding } from '@/shared/lib/shortcuts';

interface Props {
  onClose: () => void;
}

function TipSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="keyboard-tips-section">
      <h3 className="keyboard-tips-section-title">{title}</h3>
      <ul className="keyboard-tips-list">{children}</ul>
    </section>
  );
}

function Tip({ keys, children }: { keys?: string; children: React.ReactNode }) {
  return (
    <li className="keyboard-tips-item">
      {keys ? <kbd className="keyboard-tips-kbd">{keys}</kbd> : null}
      <span>{children}</span>
    </li>
  );
}

export function KeyboardTipsDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const runSel = formatBinding(getEffectiveBinding('runSelection'));
  const runAll = formatBinding(getEffectiveBinding('runAll'));
  const save = formatBinding(getEffectiveBinding('saveQuery'));
  const json = formatBinding(getEffectiveBinding('toggleJsonPanel'));
  const copy = formatBinding({ key: 'c', ctrl: true });
  const esc = formatBinding({ key: 'Escape' });

  return (
    <Modal title={t('tips.title')} onClose={onClose} size="md" scrollBody>
      <div className="modal-body">
        <p className="modal-description">{t('tips.intro')}</p>

        <TipSection title={t('tips.editorTitle')}>
          <Tip keys={runSel}>{t('tips.editorRunSelection')}</Tip>
          <Tip keys={runAll}>{t('tips.editorRunAll')}</Tip>
          <Tip keys={save}>{t('tips.editorSave')}</Tip>
          <Tip>{t('tips.editorGutter')}</Tip>
          <Tip>{t('tips.editorContext')}</Tip>
        </TipSection>

        <TipSection title={t('tips.resultsTitle')}>
          <Tip keys={copy}>{t('tips.resultsCopy')}</Tip>
          <Tip>{t('tips.resultsSort')}</Tip>
          <Tip>{t('tips.resultsRow')}</Tip>
          <Tip>{t('tips.resultsCtrlClick')}</Tip>
          <Tip>{t('tips.resultsDoubleClick')}</Tip>
          <Tip>{t('tips.resultsContext')}</Tip>
          <Tip keys={esc}>{t('tips.resultsEsc')}</Tip>
        </TipSection>

        <TipSection title={t('tips.schemaTitle')}>
          <Tip>{t('tips.schemaClick')}</Tip>
          <Tip>{t('tips.schemaDblClick')}</Tip>
        </TipSection>

        <TipSection title={t('tips.jsonTitle')}>
          <Tip keys={json}>{t('tips.jsonToggle')}</Tip>
        </TipSection>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
