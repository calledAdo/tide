import type { TransactionRecord } from '../near/types';

type LogTabProps = {
  records: TransactionRecord[];
};

export function LogTab({ records }: LogTabProps) {
  return (
    <div className="tab-content">
      {records.length ? (
        records.map((record) => (
          <p className="log-row" key={`${record.hash}-${record.time}`}>
            <span>{new Date(record.time).toLocaleTimeString()}</span>
            <b>{record.label}</b>
            <a href={record.url} target="_blank" rel="noreferrer">EXPLORER ↗</a>
          </p>
        ))
      ) : (
        <p>No local transactions yet.</p>
      )}
    </div>
  );
}
