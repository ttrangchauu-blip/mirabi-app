import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Typography';
import { PETS, PetId } from '../pets';
import { authTheme } from '../theme';
import { ElementBadge } from './ElementBadge';
import { PetArt } from './PetArt';

type Props = { value: PetId; onChange: (pet: PetId) => void; disabled?: boolean };

/** Pet adoption grid. Behaves as a radio group. */
export function PetPicker({ value, onChange, disabled }: Props) {
  const selected = PETS.find((p) => p.id === value) ?? PETS[0];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Chọn thú cưng để nuôi</Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Chọn thú cưng để nuôi">
        {PETS.map((pet) => {
          const checked = pet.id === value;
          return (
            <Pressable key={pet.id} onPress={() => onChange(pet.id)} disabled={disabled}
              accessibilityRole="radio" accessibilityState={{ checked, disabled: !!disabled }}
              accessibilityLabel={`${pet.name}, ${pet.species}, hệ ${pet.element.label}`} accessibilityHint={pet.tagline} testID={`pet-${pet.id}`}
              style={({ pressed }) => [styles.card, checked && styles.cardChecked, pressed && !disabled && styles.pressed]}>
              <PetArt pet={pet.id} size={58} stage={0} still />
              <Text style={[styles.name, checked && styles.nameChecked]} numberOfLines={1}>{pet.name}</Text>
              <Text style={styles.species} numberOfLines={1}>{pet.species}</Text>
              <View style={styles.badge}><ElementBadge element={pet.element} compact /></View>
              {checked && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{selected.element.icon} Hệ {selected.element.label} · {selected.species[0].toUpperCase() + selected.species.slice(1)} · {selected.tagline}.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '800', color: authTheme.ink, marginBottom: 8, marginLeft: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  card: { width: '31.5%', minHeight: 128, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: 18, borderWidth: 1.5, borderColor: authTheme.inputBorder, backgroundColor: authTheme.inputBg },
  cardChecked: { borderColor: authTheme.inputFocus, borderWidth: 2, backgroundColor: authTheme.infoBg,
    shadowColor: authTheme.inputFocus, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  pressed: { transform: [{ scale: 0.96 }] },
  name: { fontSize: 14, fontWeight: '800', color: authTheme.ink, marginTop: 4 },
  nameChecked: { color: authTheme.link },
  species: { fontSize: 11, color: authTheme.muted, marginTop: 1 },
  badge: { marginTop: 5 },
  check: { position: 'absolute', top: 5, right: 8, fontSize: 13, fontWeight: '900', color: authTheme.link },
  hint: { color: authTheme.muted, fontSize: 12, marginTop: 8, marginLeft: 2 },
});
