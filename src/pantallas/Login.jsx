import { useState } from 'react'
import { api } from '../lib/api'
import { Aviso, BotonPrincipal, Campo } from '../componentes/ui'

export default function Login({ onIngresar }) {
  const [nro, setNro] = useState('')
  const [dni, setDni] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function ingresar(e) {
    e.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const r = await api.login(nro, dni)
      if (!r.ok) setError(r.error)
      else onIngresar({ token: r.token, nro: r.nro, nombre: r.nombre, rol: r.rol })
    } catch (err) {
      setError(err.message)
    } finally {
      setEnviando(false)
    }
  }

  return (
    <form onSubmit={ingresar} className="flex flex-col gap-5 pt-2">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-4xl font-semibold leading-tight">Ingresá para reservar</h1>
        <p className="text-[15px] text-gris">Exclusivo para socios con carnet de tenis vigente.</p>
      </div>
      <Campo id="nro" label="Número de socio" inputMode="numeric" autoComplete="username"
        placeholder="Ej. 12345" value={nro} onChange={(e) => setNro(e.target.value)} required />
      <Campo id="dni" label="DNI" inputMode="numeric" autoComplete="current-password"
        placeholder="Sin puntos" value={dni} onChange={(e) => setDni(e.target.value)} required />
      {error && <Aviso tipo="error">{error}</Aviso>}
      <BotonPrincipal type="submit" disabled={enviando || !nro || !dni}>
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </BotonPrincipal>
      <p className="text-[13px] text-gris">¿No podés ingresar? Acercate a la Capitanía de Tenis.</p>
    </form>
  )
}
