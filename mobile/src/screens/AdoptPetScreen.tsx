import React, { useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import { errorMessage, isSessionExpired } from '../auth/messages';
import { PET_NAME_MAX, validatePetName } from '../auth/validation';
import { AuthLayout } from '../components/AuthLayout';
import { AuthTextField, FormBanner, GradientButton, TextLink } from '../components/AuthForm';
import { PetPicker } from '../components/PetPicker';
import { DEFAULT_PET, petById, PetId } from '../pets';
import { useConfirmLogout } from '../auth/useConfirmLogout';

/** First sign-in: choose a pet and name it on one screen. Saving adopts the pet and moves on to the welcome tour. */
export function AdoptPetScreen() {
  const { user, adoptPet } = useAuth();
  const confirmLogout = useConfirmLogout();
  const [petId, setPetId] = useState<PetId>(DEFAULT_PET);
  const [name, setName] = useState(petById(DEFAULT_PET).name);
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [apiError, setApiError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const pet = petById(petId);

  function choose(id: PetId) {
    setPetId(id);
    // Keep suggesting the pet's default name until the user types their own.
    if (!nameTouched) { setName(petById(id).name); setError(undefined); }
  }

  async function finish() {
    if (inFlight.current) return;
    const problem = validatePetName(name);
    setError(problem);
    if (problem) return;
    inFlight.current = true;
    setSubmitting(true);
    setApiError(null);
    Keyboard.dismiss();
    try {
      await adoptPet(petId, name);
    } catch (e) {
      if (!isSessionExpired(e)) setApiError(errorMessage(e));
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout title="Chọn và đặt tên thú cưng" showCompanion pet={petId}
      subtitle={`Chào ${user?.display_name ?? 'bạn'}! Hãy chọn một người bạn nhỏ để nuôi và đặt cho bé một cái tên thật dễ thương.`}
      footer={<TextLink title="Đăng xuất" onPress={() => { void confirmLogout(); }} />}>
      {apiError ? <FormBanner tone="error" message={apiError} /> : null}
      <PetPicker value={petId} onChange={choose} disabled={submitting} />
      <AuthTextField label={`Tên cho bé ${pet.species}`} icon="paw-outline" placeholder={pet.name} value={name} maxLength={PET_NAME_MAX}
        onChangeText={(v) => { setName(v); setNameTouched(true); if (error) setError(undefined); }}
        error={error} hint={`Tối đa ${PET_NAME_MAX} ký tự.`} autoCorrect={false} returnKeyType="done"
        onSubmitEditing={finish} editable={!submitting} testID="pet-name" />
      <GradientButton title="Đón bé về nhà ✨" onPress={finish} loading={submitting} loadingTitle="Đang đón bé về nhà…" />
    </AuthLayout>
  );
}
