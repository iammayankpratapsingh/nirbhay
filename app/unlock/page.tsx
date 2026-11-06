import UnlockForm from './UnlockForm';

export const metadata = { title: 'Unlock · Nirbhay: Pen Battle' };

export default async function UnlockPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only same-site relative paths are allowed as redirect targets.
  const safeNext = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <main className="unlock">
      <div className="unlock-card">
        <div className="brand-mark" aria-hidden="true" />
        <p className="eyebrow">Nirbhay: Pen Battle</p>
        <h1 className="display">Your desk. Your battleground.</h1>
        <p className="muted">This game is private. Enter the password to play.</p>
        <UnlockForm next={safeNext} />
        <p className="dedication">Made for Nirbhay Rajput.</p>
      </div>
    </main>
  );
}
