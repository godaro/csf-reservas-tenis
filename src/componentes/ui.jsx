// Piezas visuales compartidas

export function Titulo({ children, sub }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-display text-3xl font-semibold leading-tight text-tinta">{children}</h1>
      {sub && <p className="text-[15px] text-gris">{sub}</p>}
    </div>
  )
}

export function Etiqueta({ children }) {
  return <span className="text-[13px] font-bold text-gris">{children}</span>
}

export function BotonPrincipal({ children, className = '', ...props }) {
  return (
    <button
      {...props}
      className={`h-13 w-full rounded-xl bg-verde px-4 text-[17px] font-bold text-white transition hover:bg-verde-oscuro disabled:bg-apagado disabled:text-gris ${className}`}
    >
      {children}
    </button>
  )
}

export function Volver({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="-ml-1 flex min-h-11 items-center gap-1.5 self-start text-[15px] font-bold text-verde"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 6l-6 6 6 6" />
      </svg>
      {children}
    </button>
  )
}

export function Aviso({ tipo = 'info', children }) {
  const estilos = {
    info: 'bg-azul-claro text-azul',
    alerta: 'bg-[#fff4e5] border border-[#f2d3a6] text-[#4a3a22]',
    error: 'bg-[#fdecea] border border-[#f5c2bd] text-error',
  }
  return (
    <div role={tipo === 'error' ? 'alert' : undefined} className={`rounded-xl px-4 py-3 text-[15px] leading-snug ${estilos[tipo]}`}>
      {children}
    </div>
  )
}

export function Cargando({ texto = 'Cargando…' }) {
  return (
    <div className="flex items-center gap-3 py-6 text-gris" aria-live="polite">
      <span className="size-5 animate-spin rounded-full border-2 border-borde border-t-verde" />
      {texto}
    </div>
  )
}

export function Campo({ id, label, ...props }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-bold">{label}</label>
      <input
        id={id}
        {...props}
        className="h-12 rounded-xl border-[1.5px] border-borde bg-white px-3.5 text-base text-tinta outline-none focus:border-verde"
      />
    </div>
  )
}
