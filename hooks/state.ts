import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Attachments, Branch, Draft, Issue, Load, Pending, Schema, Summary, Tab, View } from '../types'

// The validator only follows atoms declared in the module that reads them,
// and follows `$` across files only into function declarations, so every
// read and write of this mod's state goes through these functions.

export const PANE = 'devlog'

type Fn<T> = (value: T) => T

const issuesAtom = atom({ plugin: 'devlog', key: 'issues' } as const, [] as Issue[])
const tabAtom = atom({ plugin: 'devlog', key: 'tab' } as const, 'open' as Tab)
const viewAtom = atom({ plugin: 'devlog', key: 'view' } as const, 'list' as View)
const selectedAtom = atom({ plugin: 'devlog', key: 'selected' } as const, null as string | null)
const schemaAtom = atom({ plugin: 'devlog', key: 'schema' } as const, null as Schema | null)
const draftAtom = atom({ plugin: 'devlog', key: 'draft' } as const, null as Draft | null)
const pendingAtom = atom({ plugin: 'devlog', key: 'pending' } as const, null as Pending | null)
const branchAtom = atom({ plugin: 'devlog', key: 'branch' } as const, null as Branch | null)
const summariesAtom = atom({ plugin: 'devlog', key: 'summaries' } as const, [] as Summary[])
const openSummaryAtom = atom({ plugin: 'devlog', key: 'openSummary' } as const, null as string | null)
const attachmentsAtom = atom({ plugin: 'devlog', key: 'attachments' } as const, null as Attachments | null)
const notionServersAtom = atom({ plugin: 'devlog', key: 'notionServers' } as const, [] as string[])
const loadAtom = atom({ plugin: 'devlog', key: 'load' } as const, {
  isLoading: false,
  isWriting: false,
  error: null,
  fetchedAt: null,
} as Load)

export function getIssues($: EngineInterface) {
  return read($, issuesAtom)
}
export function getTab($: EngineInterface) {
  return read($, tabAtom)
}
export function getView($: EngineInterface) {
  return read($, viewAtom)
}
export function getSelected($: EngineInterface) {
  return read($, selectedAtom)
}
export function getSchema($: EngineInterface) {
  return read($, schemaAtom)
}
export function getDraft($: EngineInterface) {
  return read($, draftAtom)
}
export function getPending($: EngineInterface) {
  return read($, pendingAtom)
}
export function getBranch($: EngineInterface) {
  return read($, branchAtom)
}
export function getLoad($: EngineInterface) {
  return read($, loadAtom)
}

export function setIssues($: EngineInterface, fn: Fn<Issue[]>) {
  return update($, issuesAtom, fn)
}
export function setTab($: EngineInterface, fn: Fn<Tab>) {
  return update($, tabAtom, fn)
}
export function setView($: EngineInterface, fn: Fn<View>) {
  return update($, viewAtom, fn)
}
export function setSelected($: EngineInterface, fn: Fn<string | null>) {
  return update($, selectedAtom, fn)
}
export function setSchema($: EngineInterface, fn: Fn<Schema | null>) {
  return update($, schemaAtom, fn)
}
export function setDraft($: EngineInterface, fn: Fn<Draft | null>) {
  return update($, draftAtom, fn)
}
export function setPending($: EngineInterface, fn: Fn<Pending | null>) {
  return update($, pendingAtom, fn)
}
export function setBranch($: EngineInterface, fn: Fn<Branch | null>) {
  return update($, branchAtom, fn)
}
export function setLoad($: EngineInterface, fn: Fn<Load>) {
  return update($, loadAtom, fn)
}
export function getSummaries($: EngineInterface) {
  return read($, summariesAtom)
}
export function setSummaries($: EngineInterface, fn: Fn<Summary[]>) {
  return update($, summariesAtom, fn)
}
export function getOpenSummary($: EngineInterface) {
  return read($, openSummaryAtom)
}
export function setOpenSummary($: EngineInterface, fn: Fn<string | null>) {
  return update($, openSummaryAtom, fn)
}
export function getAttachments($: EngineInterface) {
  return read($, attachmentsAtom)
}
export function setAttachments($: EngineInterface, fn: Fn<Attachments | null>) {
  return update($, attachmentsAtom, fn)
}
export function getNotionServers($: EngineInterface) {
  return read($, notionServersAtom)
}
export function setNotionServers($: EngineInterface, fn: Fn<string[]>) {
  return update($, notionServersAtom, fn)
}
