import { useState } from 'react'
import { api } from '../lib/api'
import { Aviso, BotonPrincipal, Campo } from '../componentes/ui'

// modo: 'socio' (app de reservas: número de socio + DNI)
//       'capitania' (panel en /capitania: usuario + clave)
//       'admin' (Administración en /admin: usuario + clave)
export default function Login({ onIngresar, modo = 'socio' }) {
  const panel = modo !== 'socio'
  const [id, setId] = useState('')
  const [secreto, setSecreto] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function ingresar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const r = panel ? await api.loginCapitania(id, secreto) : await api.login(id, secreto)
      if (!r.ok) return setError(r.error)
      onIngresar({ token: r.token, nro: r.nro, nombre: r.nombre, rol: r.rol })
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={ingresar} className="mx-auto flex w-full max-w-md flex-col gap-5 pt-2">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-4xl font-semibold leading-tight">
          {modo === 'admin' ? 'Administración' : panel ? 'Panel de Capitanía' : 'Ingresá para reservar'}
        </h1>
        <p className="text-[15px] text-gris">
          {modo === 'admin' ? 'Padrón de socios con carnet de tenis.' : panel ? 'Acceso exclusivo para la Capitanía de Tenis.' : 'Exclusivo para socios con carnet de tenis vigente.'}
        </p>
      </div>
      {panel ? (
        <>
          <Campo id="usuario" label="Usuario" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={id} onChange={(e) => setId(e.target.value)} required />
          <Campo id="clave" label="Clave" type="password" autoComplete="current-password"
            value={secreto} onChange={(e) => setSecreto(e.target.value)} required />
        </>
      ) : (
        <>
          <Campo id="nro" label="Número de socio" inputMode="numeric" autoComplete="username"
            placeholder="Ej. 12345" value={id} onChange={(e) => setId(e.target.value)} required />
          <Campo id="dni" label="DNI" inputMode="numeric" autoComplete="current-password"
            placeholder="Sin puntos" value={secreto} onChange={(e) => setSecreto(e.target.value)} required />
        </>
      )}
      {error && <Aviso tipo="error">{error}</Aviso>}
      <BotonPrincipal type="submit" disabled={enviando || !id || !secreto}>
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </BotonPrincipal>
      {!panel && <p className="text-[13px] text-gris">¿No podés ingresar? Acercate a la Capitanía de Tenis.</p>}
    </form>
  )
}
