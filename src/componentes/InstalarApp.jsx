import { useEffect, useState } from 'react'
import { escuchar, esCelular, esIOS, instalar, puedeInstalar, yaInstalada } from '../lib/instalar'

// Oculta hasta que la app tenga su dirección definitiva (subdominio del Club):
// así nadie la instala con la dirección de Netlify. Para mostrarla, poner true.
const MOSTRAR = false

// Tarjeta para tener la web como app en el celular (ícono en la pantalla de inicio)
export default function InstalarApp() {
  if (!MOSTRAR) return null
  return <Tarjeta />
}

function Tarjeta() {
  const [, refrescar] = useState(0)
  const [abierto, setAbierto] = useState(false)
  useEffect(() => escuchar(() => refrescar((n) => n + 1)), [])

  if (yaInstalada()) return null
  const android = puedeInstalar()
  const ios = esIOS()
  if (!android && !ios && !esCelular()) return null

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-borde bg-white p-4">
      <div className="flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width="44" height="44" className="size-11 shrink-0 rounded-xl border border-borde" />
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold">Tené la app en tu celular</span>
          <span className="text-[13px] leading-snug text-gris">Un ícono en la pantalla de inicio para reservar más rápido. No ocupa lugar.</span>
        </div>
      </div>
      {android ? (
        <button onClick={instalar}
          className="min-h-11 rounded-xl border-[1.5px] border-verde bg-white px-4 text-[15px] font-bold text-verde hover:bg-verde-claro">
          Agregar a la pantalla de inicio
        </button>
      ) : (
        <>
          <button onClick={() => setAbierto(!abierto)} aria-expanded={abierto}
            className="min-h-11 rounded-xl border-[1.5px] border-verde bg-white px-4 text-[15px] font-bold text-verde hover:bg-verde-claro">
            {abierto ? 'Cerrar' : 'Cómo agregarla'}
          </button>
          {abierto && (ios ? (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-snug">
              <li>Abrí esta página en <strong>Safari</strong>.</li>
              <li>Tocá <strong>Compartir</strong> <IconoCompartir /> (abajo o arriba de la pantalla).</li>
              <li>Elegí <strong>Agregar a inicio</strong> y después <strong>Agregar</strong>.</li>
            </ol>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[14px] leading-snug">
              <li>Abrí el menú del navegador <strong>⋮</strong> (arriba a la derecha).</li>
              <li>Elegí <strong>Agregar a la pantalla principal</strong> o <strong>Instalar app</strong>.</li>
            </ol>
          ))}
        </>
      )}
    </section>
  )
}

function IconoCompartir() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className="inline align-[-2px] text-azul" role="img" aria-label="ícono de compartir">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}
