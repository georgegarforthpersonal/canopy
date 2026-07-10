import { useState } from 'react';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import type { TextFieldProps } from '@mui/material';
import { CheckCircle, RadioButtonUnchecked, Visibility, VisibilityOff } from '@mui/icons-material';

/** Must match MIN_PASSWORD_LENGTH in app/backend/auth.py. */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * Password TextField with a show/hide toggle. NIST 800-63B recommends
 * letting people display what they typed — blind entry causes far more
 * failed sign-ins than masking prevents shoulder-surfing.
 */
export function PasswordField(props: TextFieldProps) {
  const [show, setShow] = useState(false);
  return (
    <TextField
      {...props}
      type={show ? 'text' : 'password'}
      InputProps={{
        ...props.InputProps,
        endAdornment: (
          <InputAdornment position="end">
            <IconButton
              aria-label={show ? 'Hide password' : 'Show password'}
              onClick={() => setShow((s) => !s)}
              edge="end"
              tabIndex={-1}
            >
              {show ? <VisibilityOff /> : <Visibility />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  );
}

/**
 * Live requirement line for helperText: shown upfront (never only after a
 * failed submit) and ticking green the moment it's satisfied.
 */
export function PasswordRequirement({ password }: { password: string }) {
  const ok = password.length >= MIN_PASSWORD_LENGTH;
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        color: ok ? 'success.main' : 'text.secondary',
      }}
    >
      {ok ? (
        <CheckCircle sx={{ fontSize: 14 }} />
      ) : (
        <RadioButtonUnchecked sx={{ fontSize: 14 }} />
      )}
      At least {MIN_PASSWORD_LENGTH} characters
    </Box>
  );
}
