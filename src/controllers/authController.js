// ── Request OTP ──────────────────────────────────────────────
export async function handleRequestOTP(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });
    if (!/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const result = await requestOTP(email);
    return res.json(result);
  } catch (err) {
    console.error('requestOTP error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Verify OTP ───────────────────────────────────────────────
export async function handleVerifyOTP(req, res) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'email and otp are required' });
    }

    await verifyOTP(email, otp);
    return res.json({ verified: true, email });
  } catch (err) {
    console.error('verifyOTP error:', err.message);
    return res.status(400).json({ error: err.message });
  }
}

// ── Complete Profile ─────────────────────────────────────────
export async function handleCompleteProfile(req, res) {
  try {
    const {
      phone, full_name, email, date_of_birth, bvn,
      pin, gender, address, role,
      location_area, location_city,
      skills, languages, has_vehicle, vehicle_type,
      availability, trade_category, market_name,
      weekly_income_range, business_name,
    } = req.body;

    // email is now primary — required first
    if (!email || !full_name || !date_of_birth || !bvn || !pin || !role) {
      return res.status(400).json({
        error: 'email, full_name, date_of_birth, bvn, pin, and role are required',
      });
    }

    if (!phone) {
      return res.status(400).json({ error: 'phone is required' });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    if (!/^\d{11}$/.test(bvn)) {
      return res.status(400).json({ error: 'BVN must be exactly 11 digits' });
    }

    if (!['worker', 'trader', 'employer'].includes(role)) {
      return res.status(400).json({ error: 'role must be worker, trader, or employer' });
    }

    if (!/.+@.+\..+/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const normalizedPhone = normalizePhone(phone);

    const djangoRes = await axios.post(
      `${DJANGO}/api/auth/register/`,
      {
        phone: normalizedPhone,
        full_name,
        email,
        date_of_birth,
        bvn,
        pin,
        role,
        ...(gender && { gender }),
        ...(address && { address }),
        ...(location_area && { location_area }),
        ...(location_city && { location_city }),
        skills: skills || [],
        languages: languages || [],
        has_vehicle: has_vehicle || false,
        ...(vehicle_type && vehicle_type !== 'none' && { vehicle_type }),
        availability: availability || 'full_day',
        ...(trade_category && { trade_category }),
        ...(market_name && { market_name }),
        ...(weekly_income_range && { weekly_income_range }),
        ...(business_name && { business_name }),
        channel: 'app',
      },
      { headers: INTERNAL, timeout: 8000 }
    );

    const { tokens, user } = djangoRes.data.data;
    return res.status(201).json({ message: 'Profile complete', tokens, user });

  } catch (err) {
    console.error('completeProfile error:', err.message);
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: err.message });
  }
}

// ── Login ────────────────────────────────────────────────────
export async function handleLogin(req, res) {
  try {
    const { email, pin } = req.body;

    if (!email || !pin) {
      return res.status(400).json({ error: 'email and pin are required' });
    }

    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: 'PIN must be exactly 4 digits' });
    }

    let djangoRes;
    try {
      djangoRes = await axios.post(
        `${DJANGO}/api/auth/login/`,
        { email, pin },
        { headers: INTERNAL, timeout: 15000 }
      );
    } catch (err) {
      if (err.response?.status === 401) {
        return res.status(401).json({ error: 'Invalid email or PIN.' });
      }
      if (err.response?.status === 404) {
        return res.status(404).json({ error: 'Email not registered.' });
      }
      throw err;
    }

    const { tokens, user } = djangoRes.data;
    return res.json({ message: 'Login successful', tokens, user });

  } catch (err) {
    console.error('login error:', err.message);
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

// ── Reset PIN ────────────────────────────────────────────────
export async function handleResetPinRequest(req, res) {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email is required' });

    // send OTP to email
    await requestOTP(email);
    return res.json({ message: 'OTP sent to your email. Use it to confirm PIN reset.' });
  } catch (err) {
    console.error('resetPinRequest error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

export async function handleResetPinConfirm(req, res) {
  try {
    const { email, otp, new_pin } = req.body;

    if (!email || !otp || !new_pin) {
      return res.status(400).json({ error: 'email, otp, and new_pin are required' });
    }

    if (!/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'new_pin must be exactly 4 digits' });
    }

    // verify OTP on Node side first
    await verifyOTP(email, otp);

    // then tell Django to update the PIN
    await axios.post(
      `${DJANGO}/api/auth/reset-pin/confirm/`,
      { email, new_pin },
      { headers: INTERNAL, timeout: 5000 }
    );

    return res.json({ message: 'PIN reset successfully. Please log in.' });
  } catch (err) {
    console.error('resetPinConfirm error:', err.message);
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(400).json({ error: err.message });
  }
}

// ── Change PIN ───────────────────────────────────────────────
export async function handleChangePin(req, res) {
  try {
    const { email, old_pin, new_pin } = req.body;

    if (!email || !old_pin || !new_pin) {
      return res.status(400).json({ error: 'email, old_pin, and new_pin are required' });
    }

    if (!/^\d{4}$/.test(old_pin) || !/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'PINs must be exactly 4 digits' });
    }

    if (old_pin === new_pin) {
      return res.status(400).json({ error: 'New PIN must be different from old PIN' });
    }

    await axios.post(
      `${DJANGO}/api/auth/change-pin/`,
      { email, old_pin, new_pin },
      { headers: INTERNAL, timeout: 5000 }
    );

    return res.json({ message: 'PIN changed successfully' });

  } catch (err) {
    console.error('changePin error:', err.message);
    if (err.response?.status === 401) {
      return res.status(401).json({ error: 'Old PIN is incorrect.' });
    }
    if (err.response) {
      return res.status(err.response.status).json({
        error: err.message,
        django_error: err.response.data,
      });
    }
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}