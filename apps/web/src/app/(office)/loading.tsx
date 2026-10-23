export default function Loading() {
  return (
    <div className="anim-fade fixed inset-0 z-[99] flex items-center justify-center bg-slate-900/30" role="status" aria-label="Loading">
      <div className="rounded-full bg-white p-3 shadow-xl ring-1 ring-black/5">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#5046e5]/25 border-t-[#5046e5]" />
      </div>
    </div>
  );
}
