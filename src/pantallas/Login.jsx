import { useState } from 'react'
import { api } from '../lib/api'
import { Aviso, BotonPrincipal, Campo } from '../componentes/ui'

// modo: 'socio' (app de reservas) o 'capitania' (panel en /capitania)
export default function Login({ onIngresar, modo = 'socio' }) {
  const [nro, setNro] = useState('')
  const [dni, setDni] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const panel = modo === 'capitania'

  async function ingresar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const r = await api.login(nro, dni)
      if (!r.ok) return setError(r.error)

      const esCapitania = r.rol === 'capitania'
      if (panel !== esCapitania) {
        api.logout(r.token).catch(() => {})
        return setError(panel
          ? 'Esta cuenta no tiene acceso al panel de Capitanía.'
          : 'Esta es una cuenta de Capitanía: ingresá desde el panel.')
      }
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
          {panel ? 'Panel de Capitanía' : 'Ingresá para reservar'}
        </h1>
        <p className="text-[15px] text-gris">
          {panel ? 'Acceso exclusivo para la Capitanía de Tenis.' : 'Exclusivo para socios con carnet de tenis vigente.'}
        </p>
      </div>
      <Campo id="nro" label="Número de socio" inputMode="numeric" autoComplete="username"
        placeholder="Ej. 12345" value={nro} onChange={(e) => setNro(e.target.value)} required />
      <Campo id="dni" label="DNI" inputMode="numeric" autoComplete="current-password"
        placeholder="Sin puntos" value={dni} onChange={(e) => setDni(e.target.value)} required />
      {error && (
        <Aviso tipo="error">
          {error}
          {!panel && error.includes('Capitanía: ingresá') && (
            <a href="/capitania" className="mt-1 block min-h-11 font-bold underline">Ir al panel de Capitanía</a>
          )}
        </Aviso>
      )}
      <BotonPrincipal type="submit" disabled={enviando || !nro || !dni}>
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </BotonPrincipal>
      {!panel && <p className="text-[13px] text-gris">¿No podés ingresar? Acercate a la Capitanía de Tenis.</p>}
    </form>
  )
}
