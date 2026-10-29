'use client';
import { useState } from 'react';
import { catalogRequest } from '@/lib/catalog-client';
import { callLabels } from '@/lib/calling/presentation';
export function CallEvidence({
  id,
  recordingStatus,
  transcriptStatus,
}: {
  id: string;
  recordingStatus: string;
  transcriptStatus: string;
}) {
  const [audio, setAudio] = useState(''),
    [transcript, setTranscript] = useState(''),
    [error, setError] = useState('');
  async function open(kind: 'recording' | 'transcript') {
    try {
      const result = await catalogRequest<{ url?: string; items?: { transcript: string }[]; status: string }>(
        `/api/calls/${id}/${kind}`,
      );
      if (result.status !== 'Available') throw Error(callLabels[result.status] || 'Bằng chứng chưa sẵn sàng.');
      if (kind === 'recording' && result.url) setAudio(result.url);
      if (kind === 'transcript') setTranscript((result.items || []).map((t) => t.transcript).join('\n'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <section id="recording">
        <h3>Bản ghi âm</h3>
        <p>{callLabels[recordingStatus] || recordingStatus}</p>
        {recordingStatus === 'Available' && (
          <button className="button secondary" onClick={() => open('recording')}>
            Mở bản ghi (liên kết 5 phút)
          </button>
        )}
        {audio && <audio controls src={audio} />}
      </section>
      <section id="transcript">
        <h3>Bản chép lời</h3>
        <p>{callLabels[transcriptStatus] || transcriptStatus}</p>
        {transcriptStatus === 'Available' && (
          <button className="button secondary" onClick={() => open('transcript')}>
            Xem bản chép lời
          </button>
        )}
        {transcript && <pre>{transcript}</pre>}
      </section>
      {error && (
        <p role="alert" className="form-alert error">
          {error}
        </p>
      )}
    </>
  );
}
