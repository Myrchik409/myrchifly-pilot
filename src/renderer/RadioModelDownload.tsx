import { useState } from 'react'
import { getDesktopBridge } from './desktop-bridge'
import { RETRIK_MODEL } from '../shared/radio-model'

export function RadioModelDownload() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const download = async () => {
    if (busy) return
    setBusy(true); setMessage(''); setError('')
    try {
      const desktop = getDesktopBridge()
      if (desktop?.radioModel) {
        if (await desktop.radioModel.save()) setMessage('Пакет RETRIK збережено. Інструкція є всередині архіву.')
      } else {
        const response = await fetch(`/radio-models/${RETRIK_MODEL.fileName}`)
        if (!response.ok) throw new Error('Не вдалося завантажити пакет RETRIK.')
        const data = await response.arrayBuffer()
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('')
        if (data.byteLength !== RETRIK_MODEL.bytes || digest !== RETRIK_MODEL.sha256) throw new Error('Перевірка пакета RETRIK не пройшла.')
        const url = URL.createObjectURL(new Blob([data], { type: 'application/zip' }))
        const anchor = document.createElement('a')
        anchor.href = url; anchor.download = RETRIK_MODEL.fileName
        document.body.append(anchor); anchor.click(); anchor.remove()
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
        setMessage('Завантаження RETRIK розпочато. Інструкція є всередині архіву.')
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не вдалося зберегти модель.') }
    finally { setBusy(false) }
  }
  return <section className="pilot-radio-model" aria-label="Модель для пульта">
    <div className="pilot-radio-model-title"><div><strong>Модель RETRIK для пульта</strong><small>{RETRIK_MODEL.radio} · {RETRIK_MODEL.firmware}</small></div>
      <button type="button" onClick={() => void download()} disabled={busy}>{busy ? 'Збереження…' : 'Завантажити RETRIK · ZIP'}</button></div>
    <details><summary>Як перенести на інший пульт</summary>
      <ol><li>Розпакуй ZIP і скопіюй папки <code>TEMPLATES</code> та <code>IMAGES</code> у корінь SD-картки іншого TX16S.</li>
        <li>На пульті обери <b>Manage Models → New Model → Personal → RETRIK</b>.</li>
        <li>Підключи USB Joystick, признач канали в Pilot і звір їхні напрямки на землі перед увімкненням.</li></ol>
      <p>Модель містить CH1–CH10: крен, тангаж, газ, рискання, SF, SA, P1, P3, SC, SH. Для іншої моделі пульта потрібна адаптація.</p>
      <p>У ZIP є модель EdgeTX і зображення. Калібрування, Stick Mode та RF-прив’язка іншого пульта залишаються його власними. Профіль осей Pilot переноситься окремо кнопкою «Експорт профілю».</p>
    </details>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="pilot-error">{error}</p>}
  </section>
}
