import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { walkSceneHeight, WalkLandscape } from '../src/screens/main/WalkLandscape';

const noon = () => new Date(2026, 9, 28, 12, 0, 0);

describe('the walk scene', () => {
  test.each([[568, 210], [640, 210], [844, 228], [932, 230], [1334, 230]])('on a screen %i tall it is %i tall', (screen, height) => {
    expect(walkSceneHeight(screen)).toBe(height);
  });

  function scene() {
    render(<WalkLandscape pet="fox" level={2} now={noon} />);
    const root = screen.getByTestId('walk-scene-noon');
    fireEvent(root, 'layout', { nativeEvent: { layout: { width: 296 } } });
    return StyleSheet.flatten(root.props.style).height as number;
  }

  test('a taller scene shows more sky: the land keeps the 3:1 shape of its picture and stands on the bottom edge', () => {
    const height = scene();
    const land = screen.UNSAFE_getAllByType(Image).map((image) => StyleSheet.flatten(image.props.style)).filter((style) => style.height > 100);
    expect(land.length).toBeGreaterThan(0);
    for (const style of land) {
      expect(style.width / style.height).toBeCloseTo(3, 1);
      expect(style.top + style.height).toBe(height);
      expect(style.top / height).toBeGreaterThan(0.3); // only empty sky above the picture
    }
  });

  test('the pet is whole and in the lower part of the scene', () => {
    const height = scene();
    const { bottom } = StyleSheet.flatten(screen.getByTestId('walk-pet').props.style);
    const [top, foot] = [height - bottom - 76, height - bottom];
    expect(top).toBeGreaterThan(height * 0.55);
    expect(foot).toBeLessThan(height);
  });
});
