import React, { useState } from 'react';
import {
  ALLOWED_TEXT_EXTENSIONS,
  validateTextExtension,
} from './validateFileExtension';

export default function FileUpload({ onValidFile }) {
  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);

  const handleChange = (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      setError(null);
      setSelectedFile(null);
      return;
    }

    const result = validateTextExtension(file.name);
    if (!result.valid) {
      setError(result.error);
      setSelectedFile(null);
      return;
    }

    setError(null);
    setSelectedFile(file);
    if (typeof onValidFile === 'function') {
      onValidFile(file);
    }
  };

  return (
    <div className="file-upload">
      <label htmlFor="file-upload-input">Upload a text file</label>
      <input
        id="file-upload-input"
        type="file"
        accept={ALLOWED_TEXT_EXTENSIONS.map((e) => `.${e}`).join(',')}
        onChange={handleChange}
      />
      {error && (
        <p role="alert" className="file-upload-error" style={{ color: 'red' }}>
          {error}
        </p>
      )}
      {selectedFile && (
        <p className="file-upload-success">
          Selected file: {selectedFile.name}
        </p>
      )}
    </div>
  );
}
