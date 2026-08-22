import React from 'react'
import './SkeletonCard.css'

export default function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="sk-hero sk-pulse" />
      <div className="sk-body">
        <div className="sk-line sk-title sk-pulse" />
        <div className="sk-line sk-subtitle sk-pulse" />
        <div className="sk-stats sk-pulse" />
        <div className="sk-bar sk-pulse" />
      </div>
    </div>
  )
}
