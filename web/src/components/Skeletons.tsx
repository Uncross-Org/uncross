export function CountdownSkeleton() {
  return (
    <section className="countdown card" aria-busy="true">
      <div className="cd-phase skeleton" style={{ width: 160 }}>
        &nbsp;
      </div>
      <div className="cd-big skeleton" style={{ width: 220, marginTop: 8 }}>
        &nbsp;
      </div>
      <div className="track" style={{ marginTop: 16 }} />
    </section>
  );
}
