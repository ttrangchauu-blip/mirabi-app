import React from 'react';
import { render } from '@testing-library/react-native';
import {
  Battery, Beaker, BeakerState, Bulb, ColdBox, HotPlate, LabBackdrop, Magnet, Material, MATERIAL_KINDS, Microscope, Pot, PotStage, Screen,
  Switch, Torch, WateringCan, Wire,
} from '../src/games/art/magicLab';
import {
  BridgePost, Chest, Creature, DoorFrame, DoorLeaf, ForestLayer, ForestLayerKind, LetterStone, Flower, Mushroom, MushroomColor, Plank, Rune,
  Stream, Vines,
} from '../src/games/art/wordForest';

const WIDTH = 390;
const HEIGHT = 260;
const SIZE = 80;

const renders = (element: React.ReactElement) => expect(() => render(element).unmount()).not.toThrow();

describe('Magic Lab art', () => {
  it('draws the backdrop', () => {
    renders(<LabBackdrop width={WIDTH} height={HEIGHT} />);
    renders(<LabBackdrop width={0} height={0} />);
  });

  it('draws the circuit parts in every state', () => {
    renders(<Battery size={SIZE} />);
    renders(<Wire size={SIZE} />);
    for (const lit of [true, false]) renders(<Bulb size={SIZE} lit={lit} />);
    for (const on of [true, false]) renders(<Switch size={SIZE} on={on} />);
  });

  it('draws the heat and water objects in every state', () => {
    const states: BeakerState[] = ['empty', 'ice', 'water', 'boiling', 'steam'];
    for (const state of states) for (const level of [0, 0.1, 0.5, 1]) renders(<Beaker size={SIZE} state={state} level={level} />);
    for (const on of [true, false]) renders(<HotPlate size={SIZE} on={on} />);
    renders(<ColdBox size={SIZE} />);
    for (const open of [true, false]) renders(<ColdBox size={SIZE} open={open} />);
  });

  it('draws the light, plant and other tools', () => {
    for (const on of [true, false]) renders(<Torch size={SIZE} on={on} />);
    renders(<Screen size={SIZE} />);
    const stages: PotStage[] = [0, 1, 2, 3, 4, 5];
    for (const stage of stages) renders(<Pot size={SIZE} stage={stage} />);
    renders(<WateringCan size={SIZE} />);
    renders(<Microscope size={SIZE} />);
    renders(<Magnet size={SIZE} />);
  });

  it('draws every material', () => {
    expect(MATERIAL_KINDS).toHaveLength(16);
    expect(new Set(MATERIAL_KINDS).size).toBe(16);
    for (const kind of MATERIAL_KINDS) renders(<Material kind={kind} size={SIZE} />);
  });
});

describe('Word Forest art', () => {
  it('draws every parallax layer', () => {
    const layers: ForestLayerKind[] = ['sky', 'far', 'mid', 'near'];
    for (const layer of layers) renders(<ForestLayer layer={layer} width={WIDTH} height={HEIGHT} />);
  });

  it('draws the brook and the bridge', () => {
    renders(<Stream width={WIDTH} height={120} />);
    renders(<Plank size={SIZE} />);
    renders(<BridgePost size={SIZE} />);
  });

  it('draws the door, runes and chest in every state', () => {
    renders(<DoorFrame size={SIZE} />);
    for (const side of ['left', 'right'] as const) renders(<DoorLeaf size={SIZE} side={side} />);
    for (const lit of [true, false]) renders(<Rune size={SIZE} lit={lit} />);
    for (const open of [true, false]) renders(<Chest size={SIZE} open={open} />);
  });

  it('draws the creature, its vine cage and the forest things', () => {
    for (const mood of ['trapped', 'happy'] as const) renders(<Creature size={SIZE} mood={mood} />);
    for (const layer of [0, 1, 2] as const) renders(<Vines size={SIZE} layer={layer} />);
    const colors: MushroomColor[] = ['red', 'blue', 'purple', 'gold'];
    for (const color of colors) renders(<Mushroom size={SIZE} color={color} />);
    for (const open of [true, false]) renders(<Flower size={SIZE} open={open} />);
    renders(<LetterStone size={SIZE} />);
  });
});
