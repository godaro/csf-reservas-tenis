import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Aviso } from './ui'

// Mail del socio para los avisos.
//   modo "aviso": cartel arriba de todo, solo si no tiene un mail válido.
//   modo "ficha": renglón en Mis reservas para ver o cambiar el mail.
export default function MiMail({ sesion, modo = 'aviso', onError }) {
  const [perfil, setPerfil] = useState(null)
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [listo, setListo] = useState(false)
  const [oculto, setOculto] = useState(() => {
    try { return sessionStorage.getItem('csf-tenis-mail-ahora-no') === '1' } catch { return false }
  })

  useEffect(() => {
    api.miPerfil(sesion.token).then(setPerfil).catch((e) => e.codigo === 'SESION' && onError?.(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion.token])

  async function guardar(e) {
    e.preventDefault()
    setError('')
    setGuardando(true)
    try {
      const r = await api.actualizarMiEmail(sesion.token, valor)
      setPerfil({ ...perfil, email: r.email, email_valido: true })
      setEditando(false)
      setListo(true)
    } catch (err) {
      if (err.codigo === 'SESION') onError?.(err)
      else setError(err.message)
    } finally {
      setGuardando(false)
    }
  }

  function ahoraNo() {
    setOculto(true)
    try { sessionStorage.setItem('csf-tenis-mail-ahora-no', '1') } catch { /* sin almacenamiento */ }
  }

  if (!perfil) return null

  const formulario = (
    <form onSubmit={guardar} className="flex flex-col gap-2">
      <label htmlFor={`mail-${modo}`} className="text-[13px] font-bold">Tu mail</label>
      <div className="flex flex-wrap gap-2">
        <input id={`mail-${modo}`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
          required value={valor} onChange={(e) => setValor(e.target.value)} placeholder="nombre@gmail.com"
          className="h-12 min-w-0 flex-1 rounded-xl border-[1.5px] border-borde bg-white px-3.5 text-base outline-none focus:border-verde" />
        <button disabled={guardando || !valor.trim()}
          className="h-12 rounded-xl bg-verde px-5 font-bold text-white disabled:bg-apagado disabled:text-gris">
          {guardando ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
      {error && <p role="alert" className="text-[14px] text-error">{error}</p>}
    </form>
  )

  if (modo === 'aviso') {
    if (listo) {
      return <div className="mb-4"><Aviso>¡Listo! Desde ahora te van a llegar los avisos a {perfil.email}.</Aviso></div>
    }
    if (perfil.email_valido || oculto) return null
    return (
      <section className="mb-4 flex flex-col gap-3 rounded-xl border border-[#f2d3a6] bg-[#fff4e5] p-4 text-[#4a3a22]">
        <div className="flex flex-col gap-1">
          <strong className="text-[15px]">No tenemos un mail válido tuyo</strong>
          <span className="text-[14px] leading-snug">
            Podés reservar igual, pero no te van a llegar las confirmaciones ni los avisos de cancelación. Cargalo y listo.
          </span>
        </div>
        {editando ? formulario : (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setEditando(true)} className="min-h-11 rounded-xl bg-verde px-4 font-bold text-white">Cargar mi mail</button>
            <button onClick={ahoraNo} className="min-h-11 rounded-xl px-3 font-bold text-[#8a4b00]">Ahora no</button>
          </div>
        )}
      </section>
    )
  }

  // modo "ficha"
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-borde bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-bold text-gris">Avisos por mail</span>
          <span className={`truncate text-[15px] ${perfil.email_valido ? 'text-tinta' : 'text-[#9a3412]'}`}>
            {perfil.email_valido ? perfil.email : 'Sin mail válido: no recibís avisos'}
          </span>
        </div>
        {!editando && (
          <button onClick={() => { setValor(perfil.email ?? ''); setEditando(true); setListo(false) }}
            className="min-h-11 rounded-lg border-[1.5px] border-borde px-3 text-sm font-bold hover:border-verde">
            {perfil.email_valido ? 'Cambiar' : 'Cargar mail'}
          </button>
        )}
      </div>
      {editando && formulario}
      {listo && !editando && <p className="text-[14px] text-verde">Mail guardado.</p>}
    </section>
  )
}
