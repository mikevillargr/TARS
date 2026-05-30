"use client"

import { useEffect } from "react"
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet"
import L from "leaflet"
import "leaflet/dist/leaflet.css"

// Custom DivIcon — no broken image references, matches TARS moss palette
const PIN_ICON = L.divIcon({
  html: `
    <div style="
      width: 16px; height: 16px;
      background: #2d5a4f;
      border-radius: 50%;
      border: 2.5px solid white;
      box-shadow: 0 1px 5px rgba(0,0,0,0.45);
    "></div>`,
  iconAnchor: [8, 8],
  className: "",
})

/** Re-centres map when lat/lng props change (e.g. multiple results swiped). */
function Recentre({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], map.getZoom())
  }, [lat, lng, map])
  return null
}

interface Props {
  lat: number
  lng: number
  zoom?: number
}

export default function PlaceMap({ lat, lng, zoom = 15 }: Props) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={zoom}
      style={{ height: "100%", width: "100%" }}
      // Non-interactive preview — user navigates via the action buttons below
      scrollWheelZoom={false}
      dragging={false}
      touchZoom={false}
      doubleClickZoom={false}
      keyboard={false}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Marker position={[lat, lng]} icon={PIN_ICON} />
      <Recentre lat={lat} lng={lng} />
    </MapContainer>
  )
}
