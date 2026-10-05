import React from 'react';

const LoginVisual = () => {
  return (
    <aside className="login-visual" aria-hidden="true">
      <div className="audio-orbit">
        <div className="audio-card">
          <div className="audio-card-header">
            <span />
            <p>MEETING AUDIO</p>
            <strong>LIVE</strong>
          </div>
          <div className="audio-wave">
            {Array.from({ length: 14 }).map((_, index) => (
              <span key={index} />
            ))}
          </div>
        </div>
        <div className="visual-pill visual-pill-transcript">Real-time Transcribing</div>
        <div className="visual-pill visual-pill-accuracy">98% Accuracy</div>
      </div>
    </aside>
  );
};

export default LoginVisual;
