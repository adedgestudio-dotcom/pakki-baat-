export default function BackupNudge({ onSetup, onLater }: { onSetup: () => void; onLater: () => void }) {
  return <div className="modal-backdrop backup-nudge-backdrop" role="dialog" aria-modal="true" aria-labelledby="backup-nudge-title">
    <section className="modal backup-nudge-card">
      <h2 id="backup-nudge-title">Protect your data</h2>
      <p>Pick how often Pakki Baat backs up your customers. It takes 10 seconds.</p>
      <div className="backup-nudge-actions">
        <button type="button" className="primary" onClick={onSetup}>Set up backup</button>
        <button type="button" className="outline" onClick={onLater}>Not now</button>
      </div>
    </section>
  </div>;
}
