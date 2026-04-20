'use client';

// page.tsx — the game shell. Wires the engine hook to board + sidebar + modals.

import { useMemo, useState } from 'react';
import type {
  Action,
  EdgeId,
  PlayerId,
  Resource,
  TileId,
  VertexId,
} from '@/game/types';
import { useGame } from '@/hooks/useGame';
import { Board } from '@/components/Board';
import { Sidebar } from '@/components/Sidebar';
import { Toasts } from '@/components/Toasts';
import {
  BankTradeModal,
  DevCardModal,
  DiscardModal,
  MonopolyModal,
  StealVictimModal,
  VictoryOverlay,
  YearOfPlentyModal,
} from '@/components/Modals';

type BuildMode = 'road' | 'settlement' | 'city' | 'knight' | null;
type ModalKind = 'bank' | 'devList' | 'monopoly' | 'yop' | null;
type RobberIntent = { readonly tile: TileId; readonly source: 'move' | 'knight' } | null;

const HUMAN_ID: PlayerId = 0;

export default function Page(): JSX.Element {
  const { state, dispatch, canDo, newGame, save } = useGame();
  const [buildMode, setBuildMode] = useState<BuildMode>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [robberIntent, setRobberIntent] = useState<RobberIntent>(null);

  const humanPendingDiscard = useMemo(
    () => state.pendingDiscards.find(d => d.playerId === HUMAN_ID) ?? null,
    [state.pendingDiscards],
  );

  const stealCandidates: readonly PlayerId[] = useMemo(() => {
    if (!robberIntent) return [];
    if (state.currentPlayer !== HUMAN_ID) return [];
    return candidatesForTile(state, robberIntent.tile, HUMAN_ID);
  }, [state, robberIntent]);

  // Board click routing — depends on phase + build mode.
  const onVertexClick = (vId: VertexId): void => {
    const phase = state.phase;
    if (phase === 'SETUP_1_SETTLEMENT' || phase === 'SETUP_2_SETTLEMENT') {
      dispatch({ kind: 'BUILD_SETTLEMENT', vertex: vId, free: true });
      return;
    }
    if (phase === 'ACTION' && buildMode === 'settlement') {
      dispatch({ kind: 'BUILD_SETTLEMENT', vertex: vId });
      setBuildMode(null);
      return;
    }
    if (phase === 'ACTION' && buildMode === 'city') {
      dispatch({ kind: 'BUILD_CITY', vertex: vId });
      setBuildMode(null);
      return;
    }
  };

  const onEdgeClick = (eId: EdgeId): void => {
    const phase = state.phase;
    if (phase === 'SETUP_1_ROAD' || phase === 'SETUP_2_ROAD') {
      dispatch({ kind: 'BUILD_ROAD', edge: eId, free: true });
      return;
    }
    if (phase === 'ROAD_BUILDING_1' || phase === 'ROAD_BUILDING_2') {
      dispatch({ kind: 'BUILD_ROAD', edge: eId, free: true });
      return;
    }
    if (phase === 'ACTION' && buildMode === 'road') {
      dispatch({ kind: 'BUILD_ROAD', edge: eId });
      setBuildMode(null);
      return;
    }
  };

  const onTileClick = (tId: TileId): void => {
    const phase = state.phase;
    if (phase === 'MOVE_ROBBER') {
      const candidates = candidatesForTile(state, tId, HUMAN_ID);
      if (candidates.length <= 1) {
        dispatch({ kind: 'MOVE_ROBBER', tile: tId, victim: candidates[0] ?? null });
      } else {
        setRobberIntent({ tile: tId, source: 'move' });
      }
      return;
    }
    if (phase === 'ACTION' && buildMode === 'knight') {
      const candidates = candidatesForTile(state, tId, HUMAN_ID);
      if (candidates.length <= 1) {
        dispatch({ kind: 'PLAY_KNIGHT', tile: tId, victim: candidates[0] ?? null });
        setBuildMode(null);
      } else {
        setRobberIntent({ tile: tId, source: 'knight' });
      }
      return;
    }
  };

  const onDiscardConfirm = (cards: Partial<Record<Resource, number>>): void => {
    dispatch({ kind: 'DISCARD', playerId: HUMAN_ID, cards });
  };

  const onStealVictim = (victim: PlayerId | null): void => {
    if (!robberIntent) return;
    if (robberIntent.source === 'knight') {
      dispatch({ kind: 'PLAY_KNIGHT', tile: robberIntent.tile, victim });
      setBuildMode(null);
    } else {
      dispatch({ kind: 'MOVE_ROBBER', tile: robberIntent.tile, victim });
    }
    setRobberIntent(null);
  };

  const onBankTrade = (give: Resource, getR: Resource): void => {
    dispatch({ kind: 'TRADE_BANK', give, getR });
    setModal(null);
  };

  const onMonopoly = (r: Resource): void => {
    dispatch({ kind: 'PLAY_MONOPOLY', resource: r });
    setModal(null);
  };

  const onYoP = (a: Resource, b: Resource): void => {
    dispatch({ kind: 'PLAY_YEAR_OF_PLENTY', resources: [a, b] });
    setModal(null);
  };

  const onPlayKnight = (): void => {
    // Arm knight mode — the board tile click finishes it.
    setBuildMode('knight');
    setModal(null);
  };
  const onPlayRoadBuilding = (): void => {
    if (canDo({ kind: 'PLAY_ROAD_BUILDING' }).ok) {
      dispatch({ kind: 'PLAY_ROAD_BUILDING' });
    }
    setModal(null);
  };

  const handleNewGame = (): void => {
    setBuildMode(null);
    setModal(null);
    newGame();
  };

  return (
    <div id="app">
      <div id="map-area">
        <Board
          state={state}
          buildMode={buildMode}
          onTileClick={onTileClick}
          onVertexClick={onVertexClick}
          onEdgeClick={onEdgeClick}
          canDo={canDo}
        />
      </div>
      <Sidebar
        state={state}
        humanId={HUMAN_ID}
        buildMode={buildMode}
        setBuildMode={setBuildMode}
        canDo={canDo}
        dispatch={dispatch}
        onNewGame={handleNewGame}
        onSave={save}
        onOpenBankTrade={() => setModal('bank')}
        onOpenDevPlay={() => setModal('devList')}
      />
      <Toasts state={state} />

      {humanPendingDiscard && (
        <DiscardModal
          state={state}
          playerId={HUMAN_ID}
          required={humanPendingDiscard.count}
          onConfirm={onDiscardConfirm}
        />
      )}

      {state.phase === 'STEAL' && state.currentPlayer === HUMAN_ID && stealCandidates.length > 1 && (
        <StealVictimModal
          state={state}
          candidates={stealCandidates}
          tile={state.robberTile}
          onPick={onStealVictim}
        />
      )}

      {modal === 'bank' && (
        <BankTradeModal
          state={state}
          humanId={HUMAN_ID}
          canDo={canDo}
          onConfirm={onBankTrade}
          onCancel={() => setModal(null)}
        />
      )}

      {modal === 'monopoly' && (
        <MonopolyModal
          onPick={onMonopoly}
          onCancel={() => setModal(null)}
        />
      )}

      {modal === 'yop' && (
        <YearOfPlentyModal
          onPick={onYoP}
          onCancel={() => setModal(null)}
        />
      )}

      {modal === 'devList' && (
        <DevCardModal
          state={state}
          humanId={HUMAN_ID}
          canDo={canDo}
          onPlayKnight={onPlayKnight}
          onPlayRoadBuilding={onPlayRoadBuilding}
          onPlayMonopoly={() => setModal('monopoly')}
          onPlayYearOfPlenty={() => setModal('yop')}
          onCancel={() => setModal(null)}
        />
      )}

      {state.winner !== null && (
        <VictoryOverlay
          state={state}
          winner={state.winner}
          onNewGame={handleNewGame}
        />
      )}
    </div>
  );
}

// Candidates for stealing when the robber lands on a tile, excluding self.
function candidatesForTile(
  state: ReturnType<typeof useGame>['state'],
  tileId: TileId,
  self: PlayerId,
): PlayerId[] {
  const vIds = state.board.tiles[tileId]?.vertices ?? [];
  const victims = new Set<PlayerId>();
  for (const vId of vIds) {
    const piece = state.pieces[vId];
    if (!piece) continue;
    if (piece.owner === self) continue;
    const p = state.players[piece.owner];
    if (!p) continue;
    const total = p.hand.wood + p.hand.brick + p.hand.wheat + p.hand.sheep + p.hand.ore;
    if (total > 0) victims.add(piece.owner);
  }
  return Array.from(victims);
}
