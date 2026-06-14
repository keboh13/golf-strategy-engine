import { describe, it, expect } from 'vitest'
import { enrichHolesWithOSM } from './osmCourseData.js'

describe('enrichHolesWithOSM', () => {
  const baseHoles = Array.from({ length: 18 }, (_, i) => ({
    par: i < 4 ? 4 : i === 4 ? 5 : i === 5 ? 3 : 4,
    yardage: String(350 + i * 10),
    handicap: i + 1,
    notes: '',
  }))

  it('returns unchanged holes when osmData is null', () => {
    const result = enrichHolesWithOSM(baseHoles, null)
    expect(result.hasDesignData).toBe(false)
    expect(result.holes).toBe(baseHoles)
  })

  it('returns unchanged holes when fewer than 3 pins', () => {
    const osmData = {
      pins: [{ lat: 33.65, lng: -116.26 }],
      bunkers: [],
      waterHazards: [],
      greens: [],
      tees: [],
      holes: [],
    }
    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(result.hasDesignData).toBe(false)
  })

  it('enriches holes from golf=hole ways with ref tags', () => {
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1,
      par: 4,
      nodes: [
        { lat: 33.64 + i * 0.001, lng: -116.26 },
        { lat: 33.64 + i * 0.001 + 0.002, lng: -116.26 },
        { lat: 33.64 + i * 0.001 + 0.003, lng: -116.26 },
      ],
    }))

    // Place a bunker near hole 1's green (last node)
    const greenLat = osmHoles[0].nodes[2].lat
    const greenLng = osmHoles[0].nodes[2].lng
    const bunkers = [{ lat: greenLat + 0.0002, lng: greenLng + 0.0003 }]

    const osmData = {
      pins: [],
      bunkers,
      waterHazards: [],
      greens: [],
      tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(result.hasDesignData).toBe(true)
    expect(result.holes[0].osmDesign).toBeDefined()
    expect(result.holes[0].osmDesign.source).toBe('OpenStreetMap')
    expect(result.holes[0].osmDesign.hazards.length).toBeGreaterThan(0)
    expect(result.holes[0].osmDesign.hazards[0].type).toBe('bunker')
  })

  it('detects dogleg from intermediate nodes', () => {
    // Create a hole that doglegs right: tee heads north, mid shifts east, green continues north
    const osmHoles = [{
      ref: 1,
      par: 4,
      nodes: [
        { lat: 33.64, lng: -116.26 },       // tee
        { lat: 33.642, lng: -116.258 },      // mid - shifted east (right for northbound hole)
        { lat: 33.644, lng: -116.258 },      // green
      ],
    }]
    // Fill remaining 17 holes
    for (let i = 2; i <= 18; i++) {
      osmHoles.push({
        ref: i, par: 4,
        nodes: [
          { lat: 33.64 + i * 0.005, lng: -116.26 },
          { lat: 33.64 + i * 0.005 + 0.002, lng: -116.26 },
          { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
        ],
      })
    }

    const osmData = {
      pins: [], bunkers: [], waterHazards: [], greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    expect(['left', 'right']).toContain(result.holes[0].osmDesign.dogleg)
  })

  it('does not overwrite user-entered notes', () => {
    const holesWithNotes = baseHoles.map((h, i) =>
      i === 0 ? { ...h, notes: 'user note: water right' } : h
    )
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1, par: 4,
      nodes: [
        { lat: 33.64 + i * 0.005, lng: -116.26 },
        { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
      ],
    }))

    const osmData = {
      pins: [], bunkers: [{ lat: 33.643, lng: -116.2598 }],
      waterHazards: [], greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(holesWithNotes, osmData)
    expect(result.holes[0].notes).toBe('user note: water right')
  })

  it('classifies water hazards near greens', () => {
    const osmHoles = Array.from({ length: 18 }, (_, i) => ({
      ref: i + 1, par: 4,
      nodes: [
        { lat: 33.64 + i * 0.005, lng: -116.26 },
        { lat: 33.64 + i * 0.005 + 0.003, lng: -116.26 },
      ],
    }))

    // Water hazard to the left of hole 1's green
    const greenLat = osmHoles[0].nodes[1].lat
    const greenLng = osmHoles[0].nodes[1].lng
    const waterHazards = [{ lat: greenLat, lng: greenLng - 0.0003 }]

    const osmData = {
      pins: [], bunkers: [], waterHazards, greens: [], tees: [],
      holes: osmHoles,
    }

    const result = enrichHolesWithOSM(baseHoles, osmData)
    const h1Hazards = result.holes[0].osmDesign.hazards
    expect(h1Hazards.some(h => h.type === 'water')).toBe(true)
  })
})
