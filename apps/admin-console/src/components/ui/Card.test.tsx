import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './Card';

describe('Card primitives', () => {
  it('renders the full card composition with title + description + content + footer', () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>
    );
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Foot')).toBeInTheDocument();
  });

  it('renders CardTitle as an h3 by default', () => {
    render(<CardTitle>Heading</CardTitle>);
    const h = screen.getByRole('heading', { level: 3, name: 'Heading' });
    expect(h).toBeInTheDocument();
    expect(h.className).toMatch(/text-lg/);
  });
});