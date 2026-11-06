'use client';

import type { Ref } from 'react';

export default function HowToDialog({ ref }: { ref: Ref<HTMLDialogElement> }) {
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="howto-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2 id="howto-title" className="display">How to play</h2>
          <form method="dialog">
            <button className="icon-btn" aria-label="Close">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
            </button>
          </form>
        </div>
        <ol className="howto">
          <li>
            <strong>Grab your pen.</strong> On your turn your pen glows lime. Press on it (or near it) with a mouse or finger.
          </li>
          <li>
            <strong>Drag backwards to aim.</strong> Like a slingshot: the arrow points where the pen will fly. The further you
            drag, the stronger the flick, up to 100%.
          </li>
          <li>
            <strong>Release to flick.</strong> Grab near an end of the pen to add spin. Hit the other pen to send it flying.
          </li>
          <li>
            <strong>Knock it off.</strong> A pen is out only once it has completely left the table. The last pen standing wins.
            If both pens fall on the same shot, it&apos;s a draw. Careful: flicking your own pen off loses!
          </li>
          <li>
            <strong>Turns switch</strong> when every pen has stopped moving.
          </li>
        </ol>
        <h3 className="section-title">Modes</h3>
        <ul className="howto-modes">
          <li><strong>Vs Computer</strong> — Easy, Normal or Hard desk bot.</li>
          <li><strong>Pass &amp; Play</strong> — two players take turns on one device.</li>
          <li>
            <strong>Online</strong> — create a room, send the 6-letter code or invite link to a friend, and both press
            “I&apos;m ready”.
          </li>
        </ul>
        <h3 className="section-title">Keyboard</h3>
        <p className="muted">
          Tab to the table, press <kbd>Enter</kbd> to start aiming, <kbd>←</kbd> <kbd>→</kbd> to turn (hold <kbd>Shift</kbd> for
          fine control), <kbd>↑</kbd> <kbd>↓</kbd> for power, <kbd>Enter</kbd> to flick and <kbd>Esc</kbd> to cancel.
        </p>
        <form method="dialog" className="dialog-foot">
          <button className="btn btn-primary">Let&apos;s battle</button>
        </form>
      </div>
    </dialog>
  );
}
